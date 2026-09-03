import { describe, expect, it } from 'vitest';
import { embedAsset, hostname, validDomain } from '../src/embeds';

describe('embed domain boundaries', () => {
  it('accepts the configured host and its legitimate subdomains', () => {
    expect(validDomain('cliente.com.br', 'cliente.com.br')).toBe(true);
    expect(validDomain('portal.cliente.com.br', 'cliente.com.br')).toBe(true);
  });

  it('rejects suffix lookalikes and unrelated origins', () => {
    expect(validDomain('cliente.com.br.evil.example', 'cliente.com.br')).toBe(false);
    expect(validDomain('evilcliente.com.br', 'cliente.com.br')).toBe(false);
    expect(validDomain('outro.com.br', 'cliente.com.br')).toBe(false);
  });

  it('normalizes valid URLs and rejects malformed configured domains', () => {
    expect(hostname('https://WWW.Cliente.com.br/path')).toBe('www.cliente.com.br');
    expect(hostname('not a url')).toBeNull();
  });

  it('keeps a non-downloadable asset protected even when the embed allows downloads',async()=>{
    const db={prepare(sql:string){const statement={bind(){return statement},async first(){
      if(sql.includes('FROM embeds'))return{id:'embed-1',project_id:'project-1',allowed_products_json:'[]',branding_json:'{"downloads":true}',project_name:'Projeto'};
      if(sql.includes('FROM assets'))return{type:'model_3d',original_drive_file_id:'drive-file',mime_type:'application/octet-stream',original_name:'modelo.glb',downloadable:0,variant_drive_file_id:null,variant_mime_type:null};
      return null;
    },async all(){return{results:[{hostname:'cliente.com.br'}]}}};return statement}};
    const request=new Request('https://portal.example/api/embed/token/assets/asset/content',{headers:{origin:'https://cliente.com.br'}});
    const response=await embedAsset(request,{DB:db} as never,'token','asset-1','request-1');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({error:{code:'download_disabled'}});
  });
});
