import { buildDesignSnapshot } from './fixtures';
import type { FixtureId } from './types';
self.onmessage=(event:MessageEvent<{id:FixtureId}>)=>{
  try {self.postMessage({ok:true,snapshot:buildDesignSnapshot(event.data.id)});}
  catch(error) {self.postMessage({ok:false,error:error instanceof Error?error.message:'The sample calculation could not finish. Retry this scenario.'});}
};
