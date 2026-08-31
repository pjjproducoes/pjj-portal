import argparse, hashlib, json, os, pathlib, shutil, urllib.request
from google.auth.transport.requests import Request
from google.oauth2 import service_account
from server import process

ORIGIN=os.environ['PJJ_PROCESSOR_ORIGIN'].rstrip('/')
SERVICE_ACCOUNT=json.loads(os.environ['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'])
SECRET=hashlib.sha256((SERVICE_ACCOUNT['private_key']+'|pjj-processor-v1').encode()).hexdigest()

def api(path, payload=None):
    body=None if payload is None else json.dumps(payload).encode()
    request=urllib.request.Request(ORIGIN+path,data=body,method='POST',headers={'Authorization':'Bearer '+SECRET,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=60) as response:
            if response.status==204:return None
            return json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'portal_{error.code}_{error.read().decode()[:1000]}')

def token():
    credentials=service_account.Credentials.from_service_account_info(SERVICE_ACCOUNT,scopes=['https://www.googleapis.com/auth/drive'])
    credentials.refresh(Request())
    return credentials.token,max(120,int((credentials.expiry.timestamp()-__import__('time').time())))

def prepare(path):
    access_token,expires_in=token();api('/api/internal/drive-token',{'accessToken':access_token,'expiresIn':expires_in})
    job=api('/api/internal/jobs/claim')
    if not job:return False
    job['access_token']=access_token;pathlib.Path(path).write_text(json.dumps(job));return True

def execute(path):
    job=json.loads(pathlib.Path(path).read_text());job_id=job.pop('job_id')
    required=max(3*int(job.get('size_bytes') or 0),2*1024**3);available=shutil.disk_usage('/').free
    if required>available:
        api(f'/api/internal/jobs/{job_id}/fail',{'error':'runner_capacity_exceeded','detail':f'Arquivo requer {required} bytes temporários; executor possui {available}.'})
        raise RuntimeError('runner_capacity_exceeded')
    payload={'accessToken':job['access_token'],'inputFileId':job['original_drive_file_id'],'outputFolderId':job['output_folder_id'],
             'assetId':job['asset_id'],'type':job['type'],'originalName':job['original_name']}
    try:
        api(f'/api/internal/jobs/{job_id}/heartbeat',{'progress':15});output=process(payload);api(f'/api/internal/jobs/{job_id}/complete',output)
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
