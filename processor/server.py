import hashlib, json, mimetypes, os, pathlib, shutil, subprocess, tempfile, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT=int(os.getenv('PORT','4000')); INTERNAL_TOKEN=os.getenv('PROCESSOR_INTERNAL_TOKEN','')

def run(*args):
    result=subprocess.run(args,check=True,capture_output=True,text=True)
    return result.stdout

def drive_request(url,token,method='GET',data=None,headers=None):
    h={'Authorization':f'Bearer {token}',**(headers or {})}
    return urllib.request.urlopen(urllib.request.Request(url,data=data,headers=h,method=method),timeout=1800)

def download(file_id,token,target):
    url='https://www.googleapis.com/drive/v3/files/'+urllib.parse.quote(file_id,safe='')+'?alt=media'
    with drive_request(url,token) as source,open(target,'wb') as output: shutil.copyfileobj(source,output,8*1024*1024)

def drive_metadata(file_id,token,fields='id,name,parents,mimeType,size'):
    url='https://www.googleapis.com/drive/v3/files/'+urllib.parse.quote(file_id,safe='')+'?fields='+urllib.parse.quote(fields,safe=',')
    with drive_request(url,token) as response:return json.loads(response.read())

def list_drive_children(parent_id,token):
    q=urllib.parse.quote(f"'{parent_id}' in parents and trashed=false")
    url='https://www.googleapis.com/drive/v3/files?q='+q+'&pageSize=1000&fields=files(id,name,mimeType,size)'
    with drive_request(url,token) as response:return json.loads(response.read()).get('files',[])

def download_model_companions(input_file_id,token,target_dir):
    try:
      meta=drive_metadata(input_file_id,token)
      parents=meta.get('parents') or []
      if not parents:return []
      allowed={'.mtl','.jpg','.jpeg','.png','.webp','.tif','.tiff','.bmp'}
      saved=[]
      for item in list_drive_children(parents[0],token):
        name=pathlib.Path(item.get('name') or '').name
        if not name or pathlib.Path(name).suffix.lower() not in allowed:continue
        target=pathlib.Path(target_dir)/name
        download(item['id'],token,target);saved.append(name)
      return saved
    except Exception as error:
      print(json.dumps({'warning':'model_companions_failed','detail':str(error)[:500]}));return []

def upload(path,token,parent,name,mime,properties):
    size=os.path.getsize(path); metadata=json.dumps({'name':name,'parents':[parent],'mimeType':mime,'appProperties':properties}).encode()
    init=drive_request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,md5Checksum',token,'POST',metadata,{
      'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':mime,'X-Upload-Content-Length':str(size)})
    location=init.headers['Location']; chunk=8*1024*1024; offset=0
    with open(path,'rb') as stream:
      while offset<size:
        data=stream.read(chunk); end=offset+len(data)-1
        response=drive_request(location,token,'PUT',data,{'Content-Type':mime,'Content-Length':str(len(data)),'Content-Range':f'bytes {offset}-{end}/{size}'})
        payload=response.read(); offset=end+1
    return json.loads(payload)

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
      for block in iter(lambda:f.read(8*1024*1024),b''):h.update(block)
    return h.hexdigest()

def detected_kind(path,declared):
    mime=run('file','--brief','--mime-type',str(path)).strip()
    suffix=path.suffix.lower()
    if mime in ('image/tiff','image/geotiff'):
      try:
        info=json.loads(run('gdalinfo','-json',str(path)))
        if info.get('coordinateSystem') and (info.get('geoTransform') or info.get('gcps')):return declared if declared in ('orthophoto','dsm','dtm') else 'orthophoto',mime
      except Exception:pass
    if suffix in ('.las','.laz','.copc'):return 'point_cloud',mime
    if suffix in ('.glb','.gltf','.obj','.fbx','.dae','.ply','.stl'):return 'model_3d',mime
    if mime.startswith('image/'):return 'photo',mime
    if mime.startswith('video/'):return 'video',mime
    if mime=='application/pdf':return 'pdf',mime
    return declared,mime

def process(job,token_provider=None,on_progress=None):
    def progress(value):
      if on_progress:on_progress(value)
    required=['accessToken','inputFileId','outputFolderId','assetId','type','originalName']
    if any(not job.get(k) for k in required):raise ValueError('missing_job_field')
    with tempfile.TemporaryDirectory(prefix='pjj-') as tmp:
      original=pathlib.Path(tmp)/pathlib.Path(job['originalName']).name;download(job['inputFileId'],job['accessToken'],original);progress(30)
      kind,detected_mime=detected_kind(original,job['type']); outputs=[]; metadata={'inputSha256':sha256(original),'inputBytes':original.stat().st_size,'declaredType':job['type'],'detectedType':kind,'detectedMimeType':detected_mime};progress(45)
      if kind in ('orthophoto','dsm','dtm'):
        info=json.loads(run('gdalinfo','-json',str(original)));metadata['gdal']=info
        if not info.get('coordinateSystem') or not (info.get('geoTransform') or info.get('gcps')):
          raise ValueError('geotiff_missing_georeferencing')
        cog=pathlib.Path(tmp)/(original.stem+'.cog.tif')
        run('gdal_translate','-of','COG','-co','COMPRESS=DEFLATE','-co','BIGTIFF=IF_SAFER',str(original),str(cog))
        outputs.append(('cog',cog,'image/tiff'))
        preview=pathlib.Path(tmp)/(original.stem+'.preview.jpg')
        if kind in ('dsm','dtm'):
          hill=pathlib.Path(tmp)/(original.stem+'.hillshade.tif');run('gdaldem','hillshade',str(cog),str(hill),'-compute_edges')
          run('gdal_translate','-of','JPEG','-outsize','1600','0',str(hill),str(preview))
        else:run('gdal_translate','-of','JPEG','-outsize','1600','0',str(cog),str(preview))
        outputs.append(('preview',preview,'image/jpeg'))
      elif kind=='model_3d':
        glb=pathlib.Path(tmp)/(original.stem+'.optimized.glb')
        source=original
        if original.suffix.lower()=='.obj':metadata['modelCompanions']=download_model_companions(job['inputFileId'],job['accessToken'],tmp)
        if original.suffix.lower() not in ('.glb','.gltf'):
          converted=pathlib.Path(tmp)/(original.stem+'.glb');run('assimp','export',str(original),str(converted));source=converted
        run('gltf-transform','optimize',str(source),str(glb),'--compress','meshopt');outputs.append(('optimized_glb',glb,'model/gltf-binary'))
      elif kind=='point_cloud':
        metadata['pdal']=json.loads(run('pdal','info','--metadata',str(original)))
        copc=pathlib.Path(tmp)/(original.stem+'.copc.laz')
        pipeline={'pipeline':[str(original),{'type':'writers.copc','filename':str(copc),'forward':'all'}]}
        pipeline_path=pathlib.Path(tmp)/'pipeline.json';pipeline_path.write_text(json.dumps(pipeline));run('pdal','pipeline',str(pipeline_path));outputs.append(('copc',copc,'application/vnd.laszip'))
      elif kind=='photo':
        preview=pathlib.Path(tmp)/(original.stem+'.preview.jpg');run('convert',str(original)+'[0]','-auto-orient','-thumbnail','1600x1600>','-strip','-quality','86',str(preview));outputs.append(('preview',preview,'image/jpeg'));metadata['validated']=True
      elif kind=='video':
        preview=pathlib.Path(tmp)/(original.stem+'.preview.jpg');run('ffmpeg','-hide_banner','-loglevel','error','-ss','00:00:01','-i',str(original),'-frames:v','1','-vf','scale=1600:-2:force_original_aspect_ratio=decrease','-q:v','3',str(preview));outputs.append(('preview',preview,'image/jpeg'));metadata['validated']=True
      elif kind=='pdf':
        prefix=pathlib.Path(tmp)/(original.stem+'.preview');run('pdftoppm','-f','1','-singlefile','-jpeg','-scale-to','1600',str(original),str(prefix));preview=pathlib.Path(str(prefix)+'.jpg');outputs.append(('preview',preview,'image/jpeg'));metadata['validated']=True
      elif kind in ('document','source','other'):
        metadata['validated']=True
      else:raise ValueError('unsupported_asset_type')
      progress(70);variants=[]
      for index,(variant,path,mime) in enumerate(outputs,1):
        upload_token=token_provider() if token_provider else job['accessToken']
        result=upload(path,upload_token,job['outputFolderId'],path.name,mime,{'pjjManaged':'true','assetId':job['assetId'],'variantType':variant})
        variants.append({'type':variant,'driveFileId':result['id'],'format':path.suffix.lstrip('.'),'mimeType':mime,'sizeBytes':path.stat().st_size,'sha256':sha256(path)})
        progress(70+int(25*index/max(1,len(outputs))))
      return {'metadata':metadata,'variants':variants}

class Handler(BaseHTTPRequestHandler):
  def reply(self,status,payload):
    body=json.dumps(payload,separators=(',',':')).encode();self.send_response(status);self.send_header('content-type','application/json');self.send_header('content-length',str(len(body)));self.end_headers();self.wfile.write(body)
  def do_GET(self):self.reply(200,{'ok':True}) if self.path=='/health' else self.reply(404,{'error':'not_found'})
  def do_POST(self):
    if self.path!='/process':return self.reply(404,{'error':'not_found'})
    if not INTERNAL_TOKEN or self.headers.get('authorization')!=f'Bearer {INTERNAL_TOKEN}':return self.reply(401,{'error':'unauthorized'})
    try:
      length=int(self.headers.get('content-length','0'));job=json.loads(self.rfile.read(length));self.reply(200,process(job))
    except subprocess.CalledProcessError as e:self.reply(422,{'error':'conversion_failed','detail':(e.stderr or '')[-4000:]})
    except Exception as e:self.reply(500,{'error':type(e).__name__,'detail':str(e)[:1000]})
  def log_message(self,fmt,*args):print(json.dumps({'remote':self.client_address[0],'message':fmt%args}))

if __name__=='__main__':
  ThreadingHTTPServer(('0.0.0.0',PORT),Handler).serve_forever()
