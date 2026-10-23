export function RecurrenceLoadNotice({kind,data}:{kind:'task'|'event';data:{status:string;limited:boolean;refresh:()=>void}}){
 const label=kind==='task'?'задач':'мероприятий'
 return data.status==='error'?<div className="planly-error my-3" role="alert"><p>{data.limited?'Слишком много повторений. Уменьшите диапазон календаря.':`Не удалось загрузить повторения ${label}. Разовые записи остаются доступны.`}</p><button type="button" className="planly-button-secondary mt-2" onClick={data.refresh}>Повторить загрузку повторений {label}</button></div>:data.status==='loading'?<p className="my-2 text-sm text-[var(--color-muted)]" role="status">Загружаем повторения {label}…</p>:null
}
