import {defineConfig} from '../../../node_modules/vite/dist/node/index.js';
import react from '../../../node_modules/@vitejs/plugin-react/dist/index.js';
import tailwind from '../../../node_modules/@tailwindcss/vite/dist/index.mjs';
import path from 'node:path';
const repository=path.resolve(import.meta.dirname,'../../..');
const client=path.join(repository,'apps/client/src');
const seams={'api.ts':'api.ts','transport/agent.ts':'agent.ts','features/profile/runtime.ts':'profile.ts','lib/use-elapsed-seconds.ts':'elapsed.ts','features/voice/VoiceInputController.ts':'voice-input.ts','features/voice/VoiceSessionController.ts':'voice-session.ts'};
export default defineConfig({root:import.meta.dirname,base:'./',plugins:[{
  name:'replay-data-boundary',enforce:'pre',resolveId(source,importer){
    if(!importer||!source.startsWith('.'))return;
    const resolved=path.resolve(path.dirname(importer.split('?')[0]),source).replace(/\.tsx?$/,'');
    for(const [original,replacement] of Object.entries(seams))if(resolved===path.join(client,original).replace(/\.ts$/,''))return path.join(import.meta.dirname,replacement);
  },
},react(),tailwind()],resolve:{alias:{'@':client,'react-router':path.join(repository,'node_modules/react-router')},dedupe:['react','react-dom']},define:{__ZHIYA_CLIENT_CONFIG__:JSON.stringify({apiOrigin:'http://replay.invalid',siteOrigin:'http://replay.invalid',requestTimeoutMilliseconds:30000})},build:{outDir:'../public/replay',emptyOutDir:true,chunkSizeWarningLimit:3000},server:{port:3102,host:'127.0.0.1',fs:{allow:[repository]}}});
