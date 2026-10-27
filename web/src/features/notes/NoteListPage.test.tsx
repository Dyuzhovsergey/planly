import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NoteListPage } from './NoteListPage'
import type { Note } from './api'
const text:Note={id:'n1',revision:1,kind:'text',title:'Идея',body:'Текст',items:[],createdAt:'',updatedAt:''}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status})
let items:Note[]
let fetchMock:ReturnType<typeof vi.fn>
beforeEach(()=>{
 items=[structuredClone(text)]
 fetchMock=vi.fn(async(path:string,init?:RequestInit)=>{
  if(init?.method==='POST'||init?.method==='PUT'){const value={...text,...JSON.parse(init.body as string),revision:init.method==='PUT'?2:1};items=[value];return json(value)}
  if(init?.method==='DELETE'){items=[];return new Response(null,{status:204})}
  return path==='/api/v1/notes'?json({items}):json(items[0])
 });vi.stubGlobal('fetch',fetchMock)
})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
function page(){const auth=vi.fn();render(<NoteListPage csrfToken="csrf" onAuthenticationRequired={auth}/>);return auth}
async function open(){fireEvent.click(await screen.findByRole('button',{name:/Идея/}));return screen.findByRole('dialog')}
it('creates checklist, edits and marks items, replaces with revision and deletes with confirmation',async()=>{
 page();await screen.findByText('Идея');fireEvent.click(screen.getByLabelText('Добавить заметку'))
 fireEvent.click(screen.getByRole('button',{name:/Чек-лист/}))
 fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Покупки'}})
 fireEvent.change(screen.getByLabelText('Пункт 1'),{target:{value:'Молоко'}})
 fireEvent.click(screen.getByText('Добавить пункт'));fireEvent.change(screen.getByLabelText('Пункт 2'),{target:{value:'Хлеб'}})
 fireEvent.click(screen.getByLabelText('Выполнен пункт 1'));fireEvent.click(screen.getByText('Сохранить заметку'))
 await screen.findByText('Заметка сохранена.')
 expect(JSON.parse(fetchMock.mock.calls.find(([,init])=>init?.method==='POST')![1].body)).toMatchObject({kind:'checklist',title:'Покупки',items:[{text:'Молоко',checked:true},{text:'Хлеб',checked:false}]})
 fireEvent.click(await screen.findByRole('button',{name:/Покупки/}));await screen.findByRole('dialog')
 fireEvent.click(screen.getByLabelText('Удалить пункт 2'));fireEvent.click(screen.getByText('Сохранить заметку'))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 const update=fetchMock.mock.calls.find(([,init])=>init?.method==='PUT')![1];expect(new Headers(update.headers).get('If-Match')).toBe('"1"');expect(JSON.parse(update.body).items).toHaveLength(1)
 fireEvent.click(await screen.findByRole('button',{name:/Покупки/}));await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'Удалить'}));fireEvent.click(screen.getByRole('button',{name:'Удалить заметку'}))
 await screen.findByText('Заметок пока нет. Добавьте первую.')
 const remove=fetchMock.mock.calls.find(([,init])=>init?.method==='DELETE')![1];expect(new Headers(remove.headers).get('If-Match')).toBe('"2"');expect(new Headers(remove.headers).get('X-CSRF-Token')).toBe('csrf')
})
it('preserves draft on a network error and focuses title; Escape asks before discarding',async()=>{
 page();await open();expect(screen.getByLabelText('Название')).toHaveFocus()
 fireEvent.change(screen.getByLabelText('Текст заметки'),{target:{value:'Черновик'}})
 fetchMock.mockRejectedValueOnce(new Error('offline'));fireEvent.click(screen.getByText('Сохранить заметку'));await screen.findByRole('alert')
 expect(screen.getByLabelText('Текст заметки')).toHaveValue('Черновик')
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.getByRole('alertdialog')).toBeInTheDocument()
 fireEvent.click(screen.getByText('Продолжить редактирование'));expect(screen.getByLabelText('Текст заметки')).toHaveValue('Черновик')
 fireEvent.click(screen.getByLabelText('Закрыть окно'));fireEvent.click(screen.getByRole('button',{name:'Закрыть без сохранения'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('blocks stale writes, retains draft and loads latest only after confirmation',async()=>{
 page();await open();fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Моя правка'}})
 fetchMock.mockResolvedValueOnce(json({},412));fireEvent.click(screen.getByText('Сохранить заметку'));await screen.findByRole('alert')
 expect(screen.getByLabelText('Название')).toHaveValue('Моя правка');expect(screen.getByText('Сохранить заметку')).toBeDisabled()
 items=[{...text,title:'Последняя версия',revision:3}]
 fireEvent.click(screen.getByText('Загрузить последнюю версию'));expect(screen.getByRole('alertdialog')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Загрузить версию'}))
 await waitFor(()=>expect(screen.getByLabelText('Название')).toHaveValue('Последняя версия'))
 fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Согласованная правка'}});fireEvent.click(screen.getByText('Сохранить заметку'))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 expect(new Headers(fetchMock.mock.calls.filter(([,init])=>init?.method==='PUT').at(-1)![1].headers).get('If-Match')).toBe('"3"')
})
it('retries list errors and handles unauthenticated responses',async()=>{
 fetchMock.mockRejectedValueOnce(new Error('offline'));page();await screen.findByRole('alert');fireEvent.click(screen.getByText('Повторить'));await screen.findByText('Идея')
 cleanup();fetchMock.mockResolvedValueOnce(json({},401));const auth=page();await waitFor(()=>expect(auth).toHaveBeenCalledOnce())
})
it('renders plain text safely and keeps delete failure open',async()=>{
 items=[{...text,body:'<script>bad()</script>'}];page();expect(await screen.findByText('<script>bad()</script>')).toBeInTheDocument()
 const dialog=await open();fireEvent.click(within(dialog).getByText('Удалить'));fetchMock.mockRejectedValueOnce(new Error('offline'));fireEvent.click(screen.getByRole('button',{name:'Удалить заметку'}));await screen.findByRole('alert');expect(screen.getByLabelText('Текст заметки')).toHaveValue('<script>bad()</script>')
})

it('offers types before opening a form and restores focus when choice is cancelled',async()=>{
 page();await screen.findByText('Идея')
 const add=screen.getByLabelText('Добавить заметку');add.focus();fireEvent.click(add)
 expect(screen.getByRole('dialog',{name:'Добавить заметку'})).toBeInTheDocument()
 expect(screen.queryByLabelText('Название')).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:/Текстовая заметка/})).toHaveFocus()
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(add).toHaveFocus()
 fireEvent.click(add);fireEvent.click(screen.getByRole('button',{name:/Текстовая заметка/}))
 expect(screen.getByRole('dialog',{name:'Новая текстовая заметка'})).toBeInTheDocument()
 expect(screen.getByLabelText('Название')).toHaveFocus();expect(screen.getByLabelText('Текст заметки')).toBeInTheDocument()
 expect(screen.queryByLabelText('Тип заметки')).not.toBeInTheDocument()
 fireEvent.click(screen.getByLabelText('Закрыть окно'));expect(add).toHaveFocus()
 fireEvent.click(add);fireEvent.click(screen.getByRole('button',{name:/Чек-лист/}))
 expect(screen.getByRole('dialog',{name:'Новый чек-лист'})).toBeInTheDocument();expect(screen.getByLabelText('Пункт 1')).toHaveValue('')
 fireEvent.click(screen.getByLabelText('Закрыть окно'));expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();expect(add).toHaveFocus()
 expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true)
})
it('creates text after explicit type choice',async()=>{
 page();await screen.findByText('Идея');fireEvent.click(screen.getByLabelText('Добавить заметку'));fireEvent.click(screen.getByRole('button',{name:/Текстовая заметка/}))
 fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Мысль'}});fireEvent.change(screen.getByLabelText('Текст заметки'),{target:{value:'Запись'}});fireEvent.click(screen.getByText('Сохранить заметку'))
 await screen.findByText('Заметка сохранена.')
 expect(JSON.parse(fetchMock.mock.calls.find(([,init])=>init?.method==='POST')![1].body)).toEqual({kind:'text',title:'Мысль',body:'Запись',items:[]})
})
