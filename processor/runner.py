import argparse, hashlib, json, os, pathlib, shutil, urllib.request
from server import process

ORIGIN=os.environ['PJJ_PROCESSOR_ORIGIN'].rstrip('/')
SERVICE_ACCOUNT=json.loads(os.environ['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'])
SECRET=hashlib.sha256((SERVICE_ACCOUNT['private_key']+'|pjj-processor-v1').encode()).hexdigest()

def api(path, payload=None, method='POST'):
    body=None if payload is None else json.dumps(payload).encode()
    request=urllib.request.Request(ORIGIN+path,data=body,method=method,headers={'Authorization':'Bearer '+SECRET,'Content-Type':'application/json','User-Agent':'PJJ-Portal-Processor/1.0'})
    try:
        with urllib.request.urlopen(request,timeout=60) as response:
            if response.status==204:return None
            return json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'portal_{error.code}_{error.read().decode()[:1000]}')

def token():
    value=api('/api/internal/drive-token',method='GET')
    return value['accessToken']

def prepare(path):
    job=api('/api/internal/jobs/claim')
    if not job:return False
    pathlib.Path(path).write_text(json.dumps(job));return True

def execute(path):
    job=json.loads(pathlib.Path(path).read_text());job_id=job.pop('job_id')
    required=max(3*int(job.get('size_bytes') or 0),2*1024**3);available=shutil.disk_usage('/').free
    if required>available:
        api(f'/api/internal/jobs/{job_id}/fail',{'error':'runner_capacity_exceeded','detail':f'Arquivo requer {required} bytes temporários; executor possui {available}.'})
        raise RuntimeError('runner_capacity_exceeded')
    payload={'accessToken':token(),'inputFileId':job['original_drive_file_id'],'outputFolderId':job['output_folder_id'],
             'assetId':job['asset_id'],'type':job['type'],'originalName':job['original_name']}
    try:
        api(f'/api/internal/jobs/{job_id}/heartbeat',{'progress':15});output=process(payload,token);api(f'/api/internal/jobs/{job_id}/complete',output)
    except Exception as error:
        api(f'/api/internal/jobs/{job_id}/fail',{'error':type(error).__name__,'detail':str(error)[:2000]});raise
    print(json.dumps({'ok':True,'jobId':job_id}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['prepare','execute']);parser.add_argument('job_file');args=parser.parse_args()
    if args.mode=='prepare':
        found=prepare(args.job_file);output=os.getenv('GITHUB_OUTPUT')
        if output:
            with pathlib.Path(output).open('a') as stream:stream.write(f'has_job={str(found).lower()}\n')
        print(json.dumps({'ok':True,'hasJob':found}))
    else:execute(args.job_file)
