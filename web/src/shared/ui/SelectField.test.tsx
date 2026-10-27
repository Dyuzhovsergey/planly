import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SelectField } from './SelectField'
import { Modal } from './Modal'
const options=[{value:'1',label:'Январь'},{value:'2',label:'Февраль'},{value:'3',label:'Март'}]
afterEach(cleanup)
function Field({disabled=false,editable=false}:{disabled?:boolean;editable?:boolean}){const [value,setValue]=useState(editable?'':'2');return <><label htmlFor="month">Месяц</label><SelectField id="month" label="Месяц" value={value} options={options} onValueChange={setValue} disabled={disabled} editable={editable}/><output data-testid="value">{value}</output><button>Другое поле</button></>}
it('uses a custom list, marks selection and commits a pointer choice',()=>{
 render(<Field/>);const field=screen.getByLabelText('Месяц');expect(field.tagName).toBe('BUTTON');fireEvent.click(field)
 expect(field).toHaveAttribute('aria-expanded','true');expect(screen.getByRole('option',{name:'Февраль'})).toHaveAttribute('aria-selected','true')
 fireEvent.click(screen.getByRole('option',{name:'Март'}));expect(screen.getByTestId('value')).toHaveTextContent('3');expect(screen.queryByRole('listbox')).not.toBeInTheDocument();expect(field).toHaveFocus()
})
it('supports arrow navigation, Home/End, typeahead and Enter without premature changes',()=>{
 render(<Field/>);const field=screen.getByRole('combobox');field.focus();fireEvent.keyDown(field,{key:'ArrowDown'});fireEvent.keyDown(field,{key:'End'})
 expect(field).toHaveAttribute('aria-activedescendant',screen.getByRole('option',{name:'Март'}).id);expect(screen.getByTestId('value')).toHaveTextContent('2')
 fireEvent.keyDown(field,{key:'Home'});fireEvent.keyDown(field,{key:'Enter'});expect(screen.getByTestId('value')).toHaveTextContent('1')
 fireEvent.keyDown(field,{key:'Ф'});expect(field).toHaveAttribute('aria-activedescendant',screen.getByRole('option',{name:'Февраль'}).id);fireEvent.keyDown(field,{key:'Enter'});expect(screen.getByTestId('value')).toHaveTextContent('2')
})
it('closes on Tab or an outside pointer and does not open when disabled',()=>{
 const view=render(<Field/>);const field=screen.getByRole('combobox');fireEvent.click(field);fireEvent.keyDown(field,{key:'Tab'});expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
 fireEvent.click(field);fireEvent.pointerDown(screen.getByText('Другое поле'));expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
 view.unmount();render(<Field disabled/>);fireEvent.click(screen.getByRole('combobox'));expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})
it('consumes the first Escape inside a modal, leaving the form and value intact',()=>{
 const close=vi.fn()
 function Dialog(){const fallback=useRef(null);return <Modal title="Форма" fallbackFocusRef={fallback} onClose={close}><Field/></Modal>}
 render(<Dialog/>);const field=screen.getByRole('combobox');fireEvent.click(field);fireEvent.keyDown(field,{key:'ArrowDown'});fireEvent.keyDown(field,{key:'Escape'})
 expect(screen.queryByRole('listbox')).not.toBeInTheDocument();expect(close).not.toHaveBeenCalled();expect(screen.getByTestId('value')).toHaveTextContent('2');fireEvent.keyDown(field,{key:'Escape'});expect(close).toHaveBeenCalledOnce()
})
it('filters editable suggestions while retaining manual input when none match',()=>{
 render(<Field editable/>);const input=screen.getByRole('combobox');fireEvent.focus(input);fireEvent.change(input,{target:{value:'ма'}})
 expect(screen.getAllByRole('option')).toHaveLength(1);fireEvent.keyDown(input,{key:'ArrowDown'});fireEvent.keyDown(input,{key:'Enter'});expect(input).toHaveValue('3')
 fireEvent.change(input,{target:{value:'Etc/GMT+3'}});expect(screen.getByText(/Нет подсказок/)).toHaveTextContent('Можно ввести');fireEvent.keyDown(input,{key:'Escape'});expect(input).toHaveValue('Etc/GMT+3')
})
