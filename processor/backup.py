import datetime, hashlib, json, os, urllib.request

origin=os.environ['PJJ_PROCESSOR_ORIGIN'].rstrip('/')
account=json.loads(os.environ['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'])
secret=hashlib.sha256((account['private_key']+'|pjj-processor-v1').encode()).hexdigest()
token_request=urllib.request.Request(origin+'/api/internal/drive-token',method='GET',headers={'authorization':'Bearer '+secret,'user-agent':'PJJ-Portal-Backup/1.0'})
with urllib.request.urlopen(token_request,timeout=60) as response: access_token=json.loads(response.read())['accessToken']

request=urllib.request.Request(origin+'/api/internal/backup',data=b'{}',method='POST',headers={'authorization':'Bearer '+secret,'content-type':'application/json','user-agent':'PJJ-Portal-Backup/1.0'})
with urllib.request.urlopen(request,timeout=120) as response: backup=response.read()

name='pjj-d1-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')+'.json'
boundary='pjj-backup-boundary'
metadata=json.dumps({'name':name,'parents':[os.environ['DRIVE_ROOT_FOLDER_ID']],'appProperties':{'pjjManaged':'true','kind':'d1-backup'}}).encode()
body=(b'--'+boundary.encode()+b'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+metadata+
      b'\r\n--'+boundary.encode()+b'\r\nContent-Type: application/json\r\n\r\n'+backup+b'\r\n--'+boundary.encode()+b'--')
upload=urllib.request.Request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',data=body,method='POST',headers={'authorization':'Bearer '+access_token,'content-type':'multipart/related; boundary='+boundary})
with urllib.request.urlopen(upload,timeout=120) as response: print(response.read().decode())
