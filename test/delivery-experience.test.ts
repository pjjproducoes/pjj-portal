import { describe, expect, it } from 'vitest';
import { adminV3 } from '../src/admin-v3';
import { detectedLogoMime, updateEntity } from '../src/admin-ops';
import { comparisonPage } from '../src/compare';
import { deliveryViewer } from '../src/delivery-viewer';
import { operationsUi } from '../src/ops-ui';
import { portalV2 } from '../src/portal-v2';
import { inferAssetType } from '../src/uploads';

describe('delivery product experience', () => {
  it('selects only capabilities supported by the uploaded format', () => {
    expect(inferAssetType('resultado.tif', 'image/tiff', 'auto')).toBe('orthophoto');
    expect(inferAssetType('modelo.glb', 'application/octet-stream')).toBe('model_3d');
    expect(inferAssetType('nuvem.copc.laz', 'application/octet-stream')).toBe('point_cloud');
    expect(inferAssetType('relatorio.pdf', 'application/pdf')).toBe('pdf');
    expect(inferAssetType('terreno.tif', 'image/tiff', 'dtm')).toBe('dtm');
  });

  it('renders an integrated COG viewer with private same-origin content', async () => {
    const response = deliveryViewer({
      title:'Ortofoto & campanha', type:'orthophoto', contentUrl:'/api/portal/assets/asset/content?variant=cog',
      navigation:[
        {url:'/viewer/asset-a',label:'2026-08-01 · ortofoto',current:true},
        {url:'/viewer/asset-b',label:'2026-09-01 · DSM'}
      ]
    });
    const body = await response.text();
    expect(body).toContain("fromUrl");
    expect(body).toContain('Resetar enquadramento');
    expect(body).toContain('Campanha / produto');
    expect(body).toContain('/viewer/asset-b');
    expect(body).toContain('Ortofoto &amp; campanha');
    expect(body).not.toContain('<title>Ortofoto & campanha</title>');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.has('x-frame-options')).toBe(false);
  });

  it('does not pretend a technical derivative exists', async () => {
    const response = deliveryViewer({ title:'Nuvem', type:'point_cloud', contentUrl:null });
    const body = await response.text();
    expect(body).toContain('O derivado web ainda não foi gerado.');
    expect(body).not.toContain("Copc.create");
  });

  it('offers color, relief and grayscale views only for published elevation rasters',async()=>{
    const body=await deliveryViewer({title:'DSM',type:'dsm',contentUrl:'/private/dsm?variant=cog'}).text();
    expect(body).toContain("['Cores','Relevo','Cinza']");
    expect(body).toContain('getGDALNoData');
    expect(body).toContain('faixa ');
  });

  it('detects client logos from bytes instead of trusting upload MIME', () => {
    expect(detectedLogoMime(new Uint8Array([137,80,78,71,13,10,26,10]))).toBe('image/png');
    expect(detectedLogoMime(new Uint8Array([0xff,0xd8,0xff,0xe0]))).toBe('image/jpeg');
    expect(detectedLogoMime(new TextEncoder().encode('RIFF0000WEBP'))).toBe('image/webp');
    expect(detectedLogoMime(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
  });

  it('does not let generic edits bypass publication and metadata validation',async()=>{
    const published=await updateEntity(new Request('https://portal.test',{method:'PATCH',body:JSON.stringify({status:'published'})}),{DB:{}} as never,{role:'owner',userId:'owner-1'} as never,'asset','asset-1','request-1');
    expect(published.status).toBe(400);
    await expect(published.json()).resolves.toMatchObject({error:{code:'invalid_status'}});
    const metadata=await updateEntity(new Request('https://portal.test',{method:'PATCH',body:JSON.stringify({metadata_json:'[]'})}),{DB:{}} as never,{role:'owner',userId:'owner-1'} as never,'asset','asset-1','request-1');
    expect(metadata.status).toBe(400);
    await expect(metadata.json()).resolves.toMatchObject({error:{code:'invalid_metadata'}});
  });
});

describe('active administration surface', () => {
  it('contains the operational controls injected into the shipped admin', async () => {
    const body = await adminV3().text();
    expect(body).toContain('Detectar automaticamente');
    expect(body).toContain('Demonstração pública');
    expect(body).toContain('mfaSetupDialog');
    expect(body).toContain('Códigos de recuperação');
    expect(body).toContain('Restaurar versão');
    expect(body).toContain('Lixeira');
    expect(body).toContain('Excluir definitivamente');
    expect(body).toContain('Capa do projeto');
    expect(body).toContain('Cadastrar resultado web');
    expect(body).toContain('variantDialog');
    expect(body).not.toContain('Ex.: 3,15 cm/pixel');
  });

  it('uses an authorized private asset as the project cover', async () => {
    const body = await portalV2().text();
    expect(body).toContain('project-cover');
    expect(body).toContain("x.cover_asset_id");
    expect(body).toContain('/api/portal/assets/');
  });

  it('ships syntactically valid classic scripts in the operational interfaces', async () => {
    for(const [surfaceIndex,response] of [adminV3(),portalV2(),operationsUi()].entries()){
      const body=await response.text(),scripts=[...body.matchAll(/<script(?: nonce="[^"]+")?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
      expect(scripts.length).toBeGreaterThan(0);
      for(const [scriptIndex,script] of scripts.entries())try{Function(script!)}catch(error){throw new Error(`surface ${surfaceIndex}, script ${scriptIndex}: ${String(error)}`)}
    }
  });
});

describe('temporal comparison', () => {
  it('aligns two published COG campaigns on their common bounds', async () => {
    let query=0;const db={prepare(){const statement={bind(){return statement},async first(){query+=1;return{name:'Projeto <seguro>'}},async all(){return{results:[
      {id:'a',title:'Campanha A',captured_at:'2026-08-01T10:00:00Z'},
      {id:'b',title:'Campanha B',captured_at:'2026-09-01T10:00:00Z'}
    ]}}};return statement}};
    const response=await comparisonPage({DB:db} as never,{role:'client',userId:'user-1'} as never,'project-1','request-1');
    const body=await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('window:win');
    expect(body).toContain('área geográfica em comum');
    expect(body).toContain('Tela cheia');
    expect(body).toContain('Projeto &lt;seguro&gt;');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(query).toBe(1);
  });
});
