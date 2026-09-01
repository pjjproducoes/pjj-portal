import { Container, getContainer } from '@cloudflare/containers';
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

interface ProcessingEnv {
  DB:D1Database; GEO_PROCESSOR:DurableObjectNamespace; PROCESSOR_INTERNAL_TOKEN:string;
  DRIVE_SERVICE_ACCOUNT_JSON:string; DRIVE_ROOT_FOLDER_ID:string;
  PROCESSING_WORKFLOW:Workflow;
}

export class GeoProcessor extends Container<ProcessingEnv>{defaultPort=4000;sleepAfter='20m'}

async function driveToken(env:ProcessingEnv):Promise<string>{
  const a=JSON.parse(env.DRIVE_SERVICE_ACCOUNT_JSON),now=Math.floor(Date.now()/1000),enc=(v:string|Uint8Array)=>{const b=typeof v==='string'?new TextEncoder().encode(v):v;let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
  const h=enc(JSON.stringify({alg:'RS256',typ:'JWT'})),c=enc(JSON.stringify({iss:a.client_email,scope:'https://www.googleapis.com/auth/drive',aud:a.token_uri,iat:now,exp:now+3600}));
  const der=a.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g,''),key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(der),x=>x.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig=enc(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(`${h}.${c}`))));
  const r=await fetch(a.token_uri,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${h}.${c}.${sig}`})});if(!r.ok)throw new Error('drive_auth_failed');return(await r.json() as any).access_token;
}

export class ProcessingWorkflow extends WorkflowEntrypoint<ProcessingEnv,{jobId:string}>{
  async run(event:WorkflowEvent<{jobId:string}>,step:WorkflowStep){
    const job=await step.do('claim job',async()=>{
      const row=await this.env.DB.prepare(`SELECT j.id,j.asset_id,a.type,a.original_name,a.original_drive_file_id,a.project_id,c.drive_folder_id capture_folder,p.drive_folder_id project_folder
        FROM processing_jobs j JOIN assets a ON a.id=j.asset_id JOIN projects p ON p.id=a.project_id LEFT JOIN captures c ON c.id=a.capture_id
        WHERE j.id=?1 AND j.status IN ('queued','retrying')`).bind(event.payload.jobId).first<any>();if(!row)throw new Error('job_not_claimable');
      await this.env.DB.prepare("UPDATE processing_jobs SET status='running',attempt=attempt+1,started_at=CURRENT_TIMESTAMP,progress=5 WHERE id=?1").bind(row.id).run();return row;
    });
    try {
    const output=await step.do('convert and validate',{retries:{limit:2,delay:'30 seconds',backoff:'exponential'},timeout:'6 hours'},async()=>{
      const instance=getContainer(this.env.GEO_PROCESSOR,job.asset_id),accessToken=await driveToken(this.env);
      const response=await instance.fetch(new Request('http://processor/process',{method:'POST',headers:{authorization:`Bearer ${this.env.PROCESSOR_INTERNAL_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({accessToken,inputFileId:job.original_drive_file_id,outputFolderId:job.capture_folder||job.project_folder,assetId:job.asset_id,type:job.type,originalName:job.original_name})}));
      if(!response.ok)throw new Error(`processor_${response.status}_${await response.text()}`);return response.json<any>();
    });
    await step.do('register and review',async()=>{
      const statements=output.variants.map((v:any)=>this.env.DB.prepare(`INSERT INTO asset_variants(id,asset_id,variant_type,drive_file_id,format,mime_type,size_bytes,checksum_sha256,status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'ready')
        ON CONFLICT(asset_id,variant_type) DO UPDATE SET drive_file_id=excluded.drive_file_id,format=excluded.format,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,checksum_sha256=excluded.checksum_sha256,status='ready',updated_at=CURRENT_TIMESTAMP`).bind(crypto.randomUUID(),job.asset_id,v.type,v.driveFileId,v.format,v.mimeType,v.sizeBytes,v.sha256));
      statements.push(this.env.DB.prepare("UPDATE assets SET status='review',metadata_json=?2,error_code=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(job.asset_id,JSON.stringify(output.metadata)));
      statements.push(this.env.DB.prepare("UPDATE processing_jobs SET status='succeeded',progress=100,finished_at=CURRENT_TIMESTAMP,output_json=?2 WHERE id=?1").bind(job.id,JSON.stringify(output)));await this.env.DB.batch(statements);
    });return{jobId:job.id,assetId:job.asset_id,status:'review'};
    } catch (caught) {
      const message=caught instanceof Error?caught.message:'processing_failed';
      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE processing_jobs SET status='failed',error_code='processing_failed',error_message=?2,finished_at=CURRENT_TIMESTAMP WHERE id=?1").bind(job.id,message.slice(0,2000)),
        this.env.DB.prepare("UPDATE assets SET status='failed',error_code='processing_failed',error_message=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(job.asset_id,message.slice(0,2000))
      ]);
      throw caught;
    }
  }
}

export default {async fetch(request:Request,env:ProcessingEnv){if(request.method!=='POST')return new Response('not found',{status:404});const {jobId}=await request.json<{jobId:string}>();const id=env.PROCESSING_WORKFLOW.create({params:{jobId}});return Response.json({instanceId:(await id).id},{status:202})}};
