import datetime, hashlib, json, os, urllib.parse, urllib.request
from google.auth.transport.requests import Request
from google.oauth2 import service_account

origin=os.environ['PJJ_PROCESSOR_ORIGIN'].rstrip('/')
account=json.loads(os.environ['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'])
secret=hashlib.sha256((account['private_key']+'|pjj-processor-v1').encode()).hexdigest()
if os.getenv('DRIVE_OAUTH_REFRESH_TOKEN'):
    body=urllib.parse.urlencode({'client_id':os.environ['DRIVE_OAUTH_CLIENT_ID'],'client_secret':os.environ['DRIVE_OAUTH_CLIENT_SECRET'],'refresh_token':os.environ['DRIVE_OAUTH_REFRESH_TOKEN'],'grant_type':'refresh_token'}).encode()
    with urllib.request.urlopen(urllib.request.Request('https://oauth2.googleapis.com/token',data=body,method='POST',headers={'content-type':'application/x-www-form-urlencoded'}),timeout=60) as response: access_token=json.loads(response.read())['access_token']
else:
    credentials=service_account.Credentials.from_service_account_info(account,scopes=['https://www.googleapis.com/auth/drive']);credentials.refresh(Request());access_token=credentials.token

request=urllib.request.Request(origin+'/api/internal/backup',data=b'{}',method='POST',headers={'authorization':'Bearer '+secret,'content-type':'application/json'})
with urllib.request.urlopen(request,timeout=120) as response: backup=response.read()

name='pjj-d1-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')+'.json'
boundary='pjj-backup-boundary'
metadata=json.dumps({'name':name,'parents':[os.environ['DRIVE_ROOT_FOLDER_ID']],'appProperties':{'pjjManaged':'true','kind':'d1-backup'}}).encode()
body=(b'--'+boundary.encode()+b'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+metadata+
      b'\r\n--'+boundary.encode()+b'\r\nContent-Type: application/json\r\n\r\n'+backup+b'\r\n--'+boundary.encode()+b'--')
upload=urllib.request.Request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',data=body,method='POST',headers={'authorization':'Bearer '+access_token,'content-type':'multipart/related; boundary='+boundary})
with urllib.request.urlopen(upload,timeout=120) as response: print(response.read().decode())
