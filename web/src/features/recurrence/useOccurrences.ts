import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import { listOccurrences } from './api'
import type { Kind, Occurrence } from './types'
export function useOccurrences(kind: Kind, range: {from:string;to:string} | null, zone: string, onAuthenticationRequired: () => void) {
 const [revision,setRevision]=useState(0)
 const [state,setState]=useState<{ key:string; revision:number; items:Occurrence[]; status:'loaded'|'error'; limited:boolean } | null>(null)
 const from=range?.from;const to=range?.to;const key=`${kind}/${zone}/${from}/${to}`
 useEffect(()=>{
  if(!from||!to)return
  const controller=new AbortController()
  void listOccurrences(kind,{from,to},controller.signal).then(({items})=>{if(!controller.signal.aborted)setState({key,revision,items,status:'loaded',limited:false})}).catch((error:unknown)=>{
   if(controller.signal.aborted)return
   if(error instanceof ApiError&&error.status===401){onAuthenticationRequired();return}
   setState({key,revision,items:[],status:'error',limited:error instanceof ApiError&&error.problem?.code==='occurrence_limit_exceeded'})
  })
  return ()=>controller.abort()
 },[kind,from,to,key,revision,onAuthenticationRequired])
 const current=state?.key===key&&state.revision===revision?state:null
 const refresh=useCallback(()=>setRevision(value=>value+1),[])
 return {items:current?.items??[],status:current?.status??(range?'loading':'idle'),limited:current?.limited??false,refresh}
}
