const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { date: new Date(), mode: 'month', employees: [], posts: [], report: null, review: [], duplicates: [], holidays: [], editingShift: null, editingEmployee: null, editingPost: null, toastTimer: null, excelView: false, selectedShifts: new Set(), customDays: [], importPreview: null };
const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = (value) => new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short'}).format(new Date(`${value.slice(0,10)}T12:00:00`)).replace('.', '');
const fmtTime = (value) => value ? value.slice(11,16) : '—';
const initials = (name) => name.trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
const monthStart = () => `${state.date.getFullYear()}-${String(state.date.getMonth()+1).padStart(2,'0')}-01`;
const capitalize = (text) => text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
function dateParts(value){const iso=String(value||'').slice(0,10);const d=new Date(`${iso}T12:00:00`);if(Number.isNaN(d.getTime()))return {weekday:'',day:'',month:'',year:''};const short=new Intl.DateTimeFormat('es-ES',{weekday:'short'}).format(d).replace('.','');return {weekday:capitalize(short),day:String(d.getDate()).padStart(2,'0'),month:monthNames[d.getMonth()].slice(0,3),year:d.getFullYear()};}
function commentedDate(value,withYear=false){const p=dateParts(value);return `${p.weekday} ${p.day} ${p.month}${withYear?` ${p.year}`:''}`.trim();}
function calendarDateCell(value){const p=dateParts(value);return `<span class="calendar-date"><strong>${esc(p.weekday)} ${esc(p.day)}</strong><small>${esc(p.month)} ${esc(String(p.year))}</small></span>`;}
function normalizeTimeText(value){const m=String(value||'').trim().replace('.',':').match(/^(\d{1,2}):(\d{2})$/);return m?`${m[1].padStart(2,'0')}:${m[2]}`:String(value||'').trim();}
function holidayNamesForRange(municipality,startValue,endValue){const start=String(startValue||'').slice(0,10);let end=String(endValue||'').slice(0,10);if(!start||!end)return [];if(String(endValue||'').slice(11,16)==='00:00'&&end>start){const d=new Date(`${end}T12:00:00`);d.setDate(d.getDate()-1);end=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}return [...new Set((state.holidays||[]).filter(h=>h.municipality===municipality&&h.date>=start&&h.date<=end).map(h=>h.name))];}
function shiftHolidayNames(shift){return holidayNamesForRange(shift.municipality,shift.start_at,shift.end_at);}
function holidayTag(names){return names.length?`<small class="holiday-tag" title="${esc(names.join(', '))}">Festivo</small>`:'';}
function nextDayIso(iso){const d=new Date(`${iso}T12:00:00`);d.setDate(d.getDate()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
const setMonthLabels = () => {
  const label = state.mode === 'year' ? String(state.date.getFullYear()) : `${monthNames[state.date.getMonth()]} ${state.date.getFullYear()}`;
  $('#period-label').textContent = label.charAt(0).toUpperCase()+label.slice(1);
  $$('.shared-period').forEach(el => el.textContent = label.charAt(0).toUpperCase()+label.slice(1));
  $$('#period-mode,.period-select').forEach(el => { if(el)el.value=state.mode; });
  if($('#activity-title'))$('#activity-title').textContent = state.mode === 'year' ? 'Actividad anual' : 'Actividad del equipo';
  if($('#activity-caption'))$('#activity-caption').textContent = state.mode === 'year' ? 'Turnos confirmados del año' : 'Turnos confirmados en el periodo';
  $('#employee-search').placeholder = state.mode === 'year' ? 'Buscar en el año' : 'Buscar empleado o ID';
  $$('.period-arrow').forEach(el => { if(el.id==='prev-month'||el.id==='next-month'||el.hasAttribute('data-month-step'))el.setAttribute('aria-label',state.mode==='year'?'Año anterior/siguiente':'Mes anterior/siguiente'); });
};
async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const response = await fetch(path, method === 'GET' ? { ...options, cache: 'no-store' } : options);
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try { const body = await response.json(); message = typeof body.detail === 'string' ? body.detail : (Array.isArray(body.detail) ? body.detail.map(item=>item.msg).join('; ') : (body.detail?.message || message)); } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('visible');
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(()=>node.classList.remove('visible'), 3600);
}
function showError(target, message) { target.textContent=message; target.classList.remove('hidden'); }
function clearError(target) { target.textContent=''; target.classList.add('hidden'); }
function selectedPost() { return $('#post-filter').value || ''; }
let baseSeq = 0;
let reportSeq = 0;
async function reloadBase() {
  const seq = ++baseSeq;
  const result = await Promise.all([api('/api/employees?limit=5000'),api('/api/posts'),api('/api/review'),api('/api/holidays')]);
  if (seq !== baseSeq) return;
  [state.employees,state.posts,state.review,state.holidays] = result;
  fillSelects(); renderEmployees(); renderPosts(); renderReview(); renderHolidays();
}
function fillSelects() {
  const opts = state.posts.map(p=>`<option value="${esc(p.id)}">${esc(p.code)} · ${esc(p.name)}</option>`).join('');
  ['#post-filter', ...$$('.post-select').map(el=>`#${el.id}`).filter(Boolean)].forEach(selector=>{
    const el=$(selector); if (!el) return; const old=el.value;
    el.innerHTML='<option value="">Todos los centros</option>'+opts; if(old)el.value=old;
  });
  const shiftPost=$('#shift-post'); shiftPost.innerHTML='<option value="">Selecciona centro</option>'+opts;
  const shiftEmployee=$('#shift-employee'); shiftEmployee.innerHTML='<option value="">Selecciona empleado</option>'+state.employees.map(e=>`<option value="${esc(e.id)}">${esc(e.code)} · ${esc(`${e.first_name} ${e.last_name}`.trim())}</option>`).join('');
}
async function reloadReport(force = false) {
  if(force !== true && $$('#excel-body tr.dirty').length && !window.confirm('Hay cambios sin guardar en la vista Excel. ¿Descartarlos?')) return;
  const seq = ++reportSeq;
  setMonthLabels();
  const post = selectedPost(); const search = $('#employee-search').value.trim();
  const params = new URLSearchParams({year:String(state.date.getFullYear())});
  if(state.mode==='month')params.set('month',String(state.date.getMonth()+1)); if(post)params.set('post_id',post); if(search)params.set('q',search);
  if(state.mode==='year')params.set('group_by_employee','false');
  const report=await api(`/api/reports?${params}`);
  if (seq !== reportSeq) return;
  state.report=report;
  renderReport();
}
function renderReport() {
  const report=state.report; if(!report)return;
  $('#total-hours').textContent=report.totals.hours; $('#night-hours').textContent=report.totals.night_hours; $('#holiday-hours').textContent=report.totals.holiday_hours;
  $('#employee-count').textContent=String(report.employees.length).padStart(2,'0');
  const visibleShiftCount=state.mode==='year'?(report.days||[]).reduce((sum,day)=>sum+day.shift_count,0):report.shifts.length;
  $('#shift-count').textContent=`${visibleShiftCount} turno${visibleShiftCount===1?'':'s'} confirmado${visibleShiftCount===1?'':'s'}`;
  $('#activity-summary').textContent=state.mode==='year'?`${(report.days||[]).length} días con actividad · ${visibleShiftCount} turnos`:`${visibleShiftCount} ${visibleShiftCount===1?'registro':'registros'} · ${report.employees.length} empleado${report.employees.length===1?'':'s'}`;
  const body=$('#activity-body');
  const dailyMode=state.mode==='year';
  const displayShifts=dailyMode?(report.days||[]).map(day=>({id:day.date,employee_code:`${day.shift_count} turnos`,first_name:'Total diario',last_name:'',post_name:'Todos los centros',post_code:'Agregado diario',municipality:'Comunitat Valenciana',province:'',start_at:`${day.date}T00:00`,end_at:`${day.date}T00:00`,minutes:day.minutes,night_minutes:day.night_minutes,holiday_minutes:day.holiday_minutes})):report.shifts;
  body.innerHTML=displayShifts.slice(0,250).map(s=>{
    const duration=toHHMM(s.minutes); const classes=[];
    if(s.night_minutes)classes.push(`<span class="pill pill-night">☾ ${toHHMM(s.night_minutes)}</span>`);
    if(s.holiday_minutes)classes.push(`<span class="pill pill-holiday">✳ ${toHHMM(s.holiday_minutes)}</span>`);
    return `<tr><td><div class="employee-cell"><span class="employee-avatar">${esc(initials(`${s.first_name} ${s.last_name}`))}</span><span class="employee-name"><strong>${esc(`${s.first_name} ${s.last_name}`.trim())}</strong><small>${esc(s.employee_code)}</small></span></div></td><td><span class="post-cell"><strong>${esc(s.post_name)}</strong><small>${esc(s.post_code||s.municipality||"")}</small></span></td><td><span class="date-cell">${esc(fmtDate(s.start_at))}<small>${esc(new Intl.DateTimeFormat('es-ES',{weekday:'short'}).format(new Date(`${s.start_at.slice(0,10)}T12:00:00`)))}</small></span></td><td><span class="time-cell">${dailyMode?'—':`${esc(fmtTime(s.start_at))} — ${esc(fmtTime(s.end_at))}`}</span></td><td><span class="duration-cell">${toHHMM(s.minutes)}</span></td><td>${s.night_minutes?`<span class="pill pill-night">${toHHMM(s.night_minutes)}</span>`:'<span class="pill pill-muted">—</span>'}</td><td>${s.holiday_minutes?`<span class="pill pill-holiday">${toHHMM(s.holiday_minutes)}</span>`:'<span class="pill pill-muted">—</span>'}</td><td>${dailyMode?'<span class="pill pill-muted">Agregado</span>':'<span class="pill pill-confirmed">● Confirmado</span>'}</td></tr>`;
  }).join('');
  const empty=displayShifts.length===0; $('#activity-empty').classList.toggle('hidden',!empty); $('#activity-body').closest('.table-scroll').classList.toggle('hidden',empty); $('.table-footer').classList.toggle('hidden',empty);
  renderHolidays();
  renderPostsSummary(report.posts,report.totals.minutes); renderShiftTable(report); renderSummaries(report.summaries); renderEmployees();
}
function renderSummaries(summaries){
  const card=$('#summaries-card'), heading=$('#summaries-heading'); if(!card)return;
  const rows=summaries||[]; card.classList.toggle('hidden',!rows.length); heading.classList.toggle('hidden',!rows.length);
  $('#summaries-body').innerHTML=rows.map(s=>`<tr><td><div class="employee-cell"><span class="employee-name"><strong>${esc(s.name||s.employee_code)}</strong><small>${esc(s.employee_code)}</small></span></div></td><td><span class="post-cell"><strong>${esc(s.post_name||'Sin centro')}</strong><small>${esc(s.post_code||'')}</small></span></td><td>${esc(s.month)}</td><td><strong class="duration-cell">${esc(s.hours)}</strong></td><td><span class="pill pill-muted">${esc(s.source_label||'importado')}</span></td><td><button class="text-button" data-delete-summary="${esc(s.id)}">Eliminar</button></td></tr>`).join('');
}
function toHHMM(minutes) { return `${String(Math.floor((minutes||0)/60)).padStart(2,'0')}:${String((minutes||0)%60).padStart(2,'0')}`; }
function renderPostsSummary(posts,total) {
  const root=$('#post-summary');
  if(!posts.length){root.innerHTML='<p class="subheading">Todavía no hay datos para mostrar.</p>';return;}
  root.innerHTML=posts.slice(0,5).map(p=>`<div><div class="post-row-head"><span>${esc(p.code)} <span style="color:#5f6b78">· ${esc(p.name)}</span></span><strong>${esc(p.hours)}</strong></div><div class="progress-track"><div class="progress-value" style="width:${total?Math.max(3,Math.round(100*p.minutes/total)):0}%"></div></div></div>`).join('');
}
function renderShiftTable(report) {
  const body=$('#shifts-body');
  const rows=state.mode==='year'?(report.days||[]).map(day=>({id:null,employee_code:`${day.shift_count} turnos`,first_name:'Total diario',last_name:'',post_name:'Todos los centros',municipality:'Comunitat Valenciana',start_at:`${day.date}T00:00`,end_at:`${day.date}T00:00`,minutes:day.minutes,night_minutes:day.night_minutes,holiday_minutes:day.holiday_minutes})):report.shifts;
  body.innerHTML=rows.slice(0,1000).map(s=>`<tr data-shift-row="${esc(s.id)}"><td class="check-col">${s.id?`<input type="checkbox" data-select-shift="${esc(s.id)}" aria-label="Seleccionar turno de ${esc(`${s.first_name} ${s.last_name}`.trim())}">`:''}</td><td><div class="employee-cell"><span class="employee-avatar">${esc(initials(`${s.first_name} ${s.last_name}`))}</span><span class="employee-name"><strong>${esc(`${s.first_name} ${s.last_name}`.trim())}</strong><small>${esc(s.employee_code)}</small></span></div></td><td><span class="post-cell"><strong>${esc(s.post_name)}</strong><small>${esc(s.post_code||s.municipality||"")}</small></span></td><td>${calendarDateCell(s.start_at)}${state.mode==='month'?holidayTag(shiftHolidayNames(s)):''}</td><td><span class="time-cell">${state.mode==='year'?'—':`${esc(fmtTime(s.start_at))} — ${esc(fmtTime(s.end_at))}`}</span></td><td>${state.mode==='year'?'—':(s.break_start_at&&!s.break_paid?`${esc(fmtTime(s.break_start_at))}–${esc(fmtTime(s.break_end_at))}`:'—')}</td><td><strong class="duration-cell">${toHHMM(s.minutes)}</strong></td><td>${toHHMM(s.night_minutes)}</td><td>${toHHMM(s.holiday_minutes)}</td><td>${state.mode==='year'?'—':`<div class="row-actions"><button class="shift-edit" data-edit-shift="${esc(s.id)}">Editar</button><button class="shift-edit" data-review-shift="${esc(s.id)}">Revisión</button></div>`}</td></tr>`).join('');
  $('#shifts-empty').classList.toggle('hidden',rows.length>0);
  $('#shifts-body').closest('.table-scroll').classList.toggle('hidden',rows.length===0);
  renderExcelTable(report);
  updateShiftView();
  syncShiftSelection();
}
function renderExcelTable(report) {
  const body=$('#excel-body'); if(!body)return;
  const rows=state.mode==='month'?report.shifts:[];
  const employeeOptions=(selected)=>{const known=state.employees.some(e=>e.id===selected);return (selected&&!known?`<option value="${esc(selected)}" selected>ID desconocido</option>`:'')+state.employees.map(e=>`<option value="${esc(e.id)}" ${e.id===selected?'selected':''}>${esc(e.code)} · ${esc(`${e.first_name} ${e.last_name}`.trim())}</option>`).join('');};
  const postOptions=(selected)=>{const known=state.posts.some(p=>p.id===selected);return (selected&&!known?`<option value="${esc(selected)}" selected>Centro desconocido</option>`:'')+state.posts.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.code)} · ${esc(p.name)}</option>`).join('');};
  body.innerHTML=rows.map(s=>`<tr data-shift-row="${esc(s.id)}" data-shift-id="${esc(s.id)}"><td class="check-col"><input type="checkbox" data-select-shift="${esc(s.id)}" aria-label="Seleccionar turno"></td><td><div class="excel-date"><input data-field="date" name="date" type="date" value="${esc(s.start_at.slice(0,10))}"><small class="date-weekday">${esc(commentedDate(s.start_at))}</small>${holidayTag(shiftHolidayNames(s))}</div></td><td><select data-field="employee_id" name="employee_id">${employeeOptions(s.employee_id)}</select></td><td><select data-field="post_id" name="post_id">${postOptions(s.post_id)}</select></td><td><div class="excel-time-range"><input class="excel-time-input" data-field="start_time" name="start_time" type="text" inputmode="numeric" maxlength="5" value="${esc(s.start_at.slice(11,16))}"><span>—</span><input class="excel-time-input" data-field="end_time" name="end_time" type="text" inputmode="numeric" maxlength="5" value="${esc(s.end_at.slice(11,16))}"></div></td><td><div class="excel-time-range"><input class="excel-time-input" data-field="free_start_time" name="free_start_time" type="text" inputmode="numeric" maxlength="5" value="${esc(((s.break_start_at&&!s.break_paid? s.break_start_at:'')||'').slice(11,16))}"><span>—</span><input class="excel-time-input" data-field="free_end_time" name="free_end_time" type="text" inputmode="numeric" maxlength="5" value="${esc(((s.break_end_at&&!s.break_paid? s.break_end_at:'')||'').slice(11,16))}"></div></td><td><strong class="duration-cell">${toHHMM(s.minutes)}</strong></td><td>${toHHMM(s.night_minutes)}</td><td>${toHHMM(s.holiday_minutes)}</td><td><button class="shift-edit" type="button" data-review-shift="${esc(s.id)}">Revisión</button></td></tr>`).join('');
  $('#excel-empty').classList.toggle('hidden',rows.length>0);
  $('#excel-body').closest('.table-scroll').classList.toggle('hidden',rows.length===0);
}
function updateShiftView() {
  const excel=state.excelView&&state.mode==='month';
  $('#shifts-card')?.classList.toggle('hidden',excel);
  $('#excel-card')?.classList.toggle('hidden',!excel);
  const toggle=$('#toggle-excel');
  if(toggle){toggle.textContent=excel?'▤ Vista normal':'▦ Vista Excel';toggle.disabled=state.mode==='year';toggle.title=state.mode==='year'?'La edición rápida solo está disponible en vista mensual':'';}
}
function syncShiftSelection() {
  const ids=state.mode==='month'?(state.report?.shifts||[]).map(s=>s.id):[];
  const valid=new Set(ids);
  [...state.selectedShifts].forEach(id=>{if(!valid.has(id))state.selectedShifts.delete(id)});
  $$('[data-select-shift]').forEach(cb=>{cb.checked=state.selectedShifts.has(cb.dataset.selectShift)});
  const count=state.selectedShifts.size;
  const bar=$('#bulk-bar'); if(bar)bar.classList.toggle('hidden',count===0);
  const label=$('#bulk-count'); if(label)label.textContent=`${count} seleccionado${count===1?'':'s'}`;
  $$('.select-all-shifts').forEach(cb=>{cb.checked=ids.length>0&&count===ids.length;cb.indeterminate=count>0&&count<ids.length;cb.disabled=ids.length===0;});
}
async function sendShiftsToReview(ids) {
  const unique=[...new Set(ids)].filter(Boolean);
  if(!unique.length)return toast('Selecciona al menos un turno.');
  if(!window.confirm(`¿Enviar ${unique.length} turno(s) a revisión? Dejarán de contar en los totales hasta confirmarlos.`))return;
  try{
    const result=await api('/api/shifts/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:unique})});
    state.selectedShifts.clear();
    await loadAll();
    await reloadReview();
    toast(`${result.updated} turno(s) enviados a revisión.`);
  }catch(error){toast(error.message)}
}
async function saveExcelChanges() {
  const rows=$$('#excel-body tr.dirty');
  if(!rows.length)return toast('No hay cambios pendientes.');
  const errors=[];
  for(const row of rows){
    const value=(name)=>row.querySelector(`[data-field="${name}"]`)?.value||'';
    const day=value('date');const startTime=normalizeTimeText(value('start_time'));const endTime=normalizeTimeText(value('end_time'));
    if(!day||!startTime||!endTime){errors.push('Fecha u horario incompletos');continue;}
    const startAt=`${day}T${startTime}`;
    const endDay=endTime<=startTime?nextDayIso(day):day;
    const endAt=`${endDay}T${endTime}`;
    const freeStartTime=normalizeTimeText(value('free_start_time'));const freeEndTime=normalizeTimeText(value('free_end_time'));
    if(Boolean(freeStartTime)!==Boolean(freeEndTime)){errors.push('Indica desde y hasta del espacio libre');continue;}
    const freeBaseDay=freeStartTime&&freeStartTime<startTime?endDay:day;
    const freeStartAt=freeStartTime?`${freeBaseDay}T${freeStartTime}`:null;
    const freeEndAt=freeEndTime?(freeEndTime<=freeStartTime?`${nextDayIso(freeBaseDay)}T${freeEndTime}`:`${freeBaseDay}T${freeEndTime}`):null;
    const payload={employee_id:value('employee_id'),post_id:value('post_id'),start_at:startAt,end_at:endAt,break_start_at:freeStartAt,break_end_at:freeEndAt,break_paid:false};
    try{await api(`/api/shifts/${row.dataset.shiftId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
    catch(error){errors.push(error.message);}
  }
  await reloadReport(true);
  toast(errors.length?`No se guardó todo: ${errors[0]}`:`${rows.length} turno(s) actualizados.`);
}
function renderEmployees() {
  const q=($('#employees-search')?.value||'').trim().toLocaleLowerCase('es');
  const people=state.employees.filter(e=>`${e.code} ${e.first_name} ${e.last_name}`.toLocaleLowerCase('es').includes(q));
  $('#employee-total').textContent=`${people.length} empleado${people.length===1?'':'s'}`;
  $('#employee-grid').innerHTML=people.map(e=>`<article class="person-card"><div class="person-card-top"><span class="employee-avatar">${esc(initials(`${e.first_name} ${e.last_name}`))}</span><span class="employee-name"><strong>${esc(`${e.first_name} ${e.last_name}`.trim())}</strong><small>Vigilante de seguridad</small></span><span class="person-card-code">${esc(e.code)}</span></div><div class="person-metrics"><span class="person-metric"><strong data-emp-hours="${esc(e.id)}">—</strong><small data-hours-label>HORAS MES</small></span><span class="person-metric"><strong data-emp-night="${esc(e.id)}">—</strong><small>NOCTURNAS</small></span><span class="person-metric"><strong data-emp-holiday="${esc(e.id)}">—</strong><small>FESTIVAS</small></span></div><div class="card-actions"><button class="text-button" data-edit-employee="${esc(e.id)}">Editar</button><button class="text-button danger" data-delete-employee="${esc(e.id)}">Eliminar</button></div><button class="text-button employee-report" data-code="${esc(e.code)}">Ver actividad →</button></article>`).join('') || '<div class="table-empty"><strong>No hay empleados coincidentes</strong></div>';
  $$('[data-hours-label]').forEach(el=>{el.textContent=state.mode==='year'?'HORAS AÑO':'HORAS MES'});
  for(const e of people){
    const row=state.report?.employees.find(item=>item.employee_id===e.id);
    const hours=$(`[data-emp-hours="${CSS.escape(e.id)}"]`); if(hours)hours.textContent=row?.hours||'00:00';
    const night=$(`[data-emp-night="${CSS.escape(e.id)}"]`); if(night)night.textContent=row?.night_hours||'00:00';
    const holiday=$(`[data-emp-holiday="${CSS.escape(e.id)}"]`); if(holiday)holiday.textContent=row?.holiday_hours||'00:00';
  }
}
function renderPosts() {
  $('#post-grid').innerHTML=state.posts.map(p=>`<article class="post-card"><div class="post-card-top"><span class="stat-icon icon-green">⌖</span><span class="employee-name"><strong>${esc(p.name)}</strong><small>${esc(p.code)} · Centro de trabajo</small></span></div><p class="post-location">Vigilante de seguridad · Castellón</p><div class="post-card-foot">Festivos por municipio · Calendario manual</div><div class="card-actions"><button class="text-button" data-edit-post="${esc(p.id)}">Editar</button><button class="text-button danger" data-delete-post="${esc(p.id)}">Eliminar</button></div></article>`).join('') || '<div class="table-empty"><strong>Aún no hay centros</strong><small>Añade un centro para empezar.</small></div>';
}
async function reloadHolidays(){state.holidays=await api('/api/holidays');renderHolidays();}
function todayIso(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function upcomingHolidays(limit){const today=todayIso();const rows=(state.holidays||[]).filter(h=>h.date>=today).sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'es'));return limit?rows.slice(0,limit):rows;}
function holidayDayMonth(iso){const d=new Date(`${iso}T12:00:00`);return {day:String(d.getDate()).padStart(2,'0'),month:monthNames[d.getMonth()].slice(0,3).toUpperCase(),year:d.getFullYear(),weekday:new Intl.DateTimeFormat('es-ES',{weekday:'short'}).format(d)};}
function renderSidebarHolidays(){
  const root=$('#sidebar-holidays'); if(!root)return;
  const all=upcomingHolidays();const rows=all.slice(0,4);
  const count=$('#sidebar-holidays-count');if(count)count.textContent=String(all.length);
  root.innerHTML=rows.map(h=>{const d=holidayDayMonth(h.date);return `<a class="sidebar-holiday" href="#centros" data-holiday-link><span class="sidebar-holiday-date"><strong>${d.day}</strong><small>${esc(d.month)}</small></span><span class="sidebar-holiday-text"><strong>${esc(h.name)}</strong><small>${d.year} · ${esc(d.weekday)}</small></span></a>`;}).join('')||'<p class="sidebar-holiday-empty">Sin festivos próximos.</p>';
}
function renderHolidays(){
  const root=$('#holiday-list');if(!root)return;
  const rows=upcomingHolidays();
  if(!rows.length){root.innerHTML='<p class="subheading">No hay festivos próximos. Añade los locales de cada municipio.</p>';renderSidebarHolidays();return;}
  let year='';
  root.innerHTML=rows.map(h=>{
    const d=holidayDayMonth(h.date);
    const yearRow=d.year!==year?`<div class="holiday-year">${d.year}</div>`:'';
    year=d.year;
    return `${yearRow}<div class="holiday-row"><strong>${esc(h.date)}</strong><span><strong>${esc(h.name)}</strong><small>${esc(h.municipality)}</small></span><button type="button" aria-label="Eliminar festivo" data-delete-holiday="${esc(h.id)}">Eliminar</button></div>`;
  }).join('');
  renderSidebarHolidays();
}

function reviewChips(raw){
  const chips=[];
  const add=(label,value)=>{if(value)chips.push(`<span class="review-chip"><small>${esc(label)}</small><strong>${esc(value)}</strong></span>`)};
  add('Empleado',raw.employee_label||raw.employee_code||raw.employee_name);
  add('Centro',raw.post_label||raw.post_name||raw.post_code);
  if(raw.start_at||raw.end_at)add('Horario',`${fmtTime(raw.start_at)} – ${fmtTime(raw.end_at)}`);
  if(raw.break_start_at&&!raw.break_paid)add('Espacio libre',`${fmtTime(raw.break_start_at)} – ${fmtTime(raw.break_end_at)}`);
  if(raw.month)add('Mes',raw.month);
  if(raw.total_hours||raw.hours)add('Total',raw.total_hours||raw.hours);
  return chips.length?`<div class="review-detected">${chips.join('')}</div>`:'';
}
function reviewRawDetails(raw){
  const skip=new Set(['kind','line','status','errors','duplicate_of','post_label','employee_label','start_at','end_at','break_start_at','break_end_at']);
  const entries=Object.entries(raw).filter(([key,value])=>!skip.has(key)&&value!==null&&value!==undefined&&String(value).trim()!=='').slice(0,24);
  if(!entries.length)return '';
  return `<details class="review-raw"><summary>Ver fila original y detección</summary><dl>${entries.map(([key,value])=>`<div><dt>${esc(key)}</dt><dd>${esc(String(value))}</dd></div>`).join('')}</dl></details>`;
}
function renderReview() {
  const root=$('#review-list'); const items=state.review||[];
  $('#review-count').textContent=String(items.length);
  const has=items.length>0; $('#review-empty').classList.toggle('hidden',has); root.classList.toggle('hidden',!has);
  root.innerHTML=items.map(item=>{
    if(item.kind==='shift'){
      const s=item.shift;
      return `<article class="review-card"><div class="review-card-head"><div class="review-source"><strong>${esc(s.employee_code)} · ${esc(`${s.first_name} ${s.last_name}`.trim())}</strong><small>${esc(s.source_label||'Importación')} · ${esc(s.post_name)} · ${esc(s.post_code||'')} · ${esc(s.start_at.slice(0,10))} · ${esc(fmtTime(s.start_at))}–${esc(fmtTime(s.end_at))}${s.break_start_at&&!s.break_paid?` · libre ${esc(fmtTime(s.break_start_at))}–${esc(fmtTime(s.break_end_at))}`:''}</small></div><span class="pill pill-pending">Pendiente de confirmar</span></div><div class="review-card-actions"><button class="button button-secondary" data-discard-shift="${esc(s.id)}">Descartar</button><button class="button button-secondary" data-edit-pending="${esc(s.id)}">Editar</button><button class="button button-primary" data-confirm-shift="${esc(s.id)}">Confirmar turno</button></div></article>`;
    }
    const raw=item.raw||{};
    if(raw.kind==='summary'){
      const selected=raw.employee_id||(state.employees.find(e=>e.code===raw.employee_code)?.id||'');
      return `<article class="review-card" data-review-card="${esc(item.id)}"><div class="review-card-head"><div class="review-source"><strong>${esc(raw.employee_label||raw.employee_code||'Resumen mensual')}</strong><small>Resumen mensual · ${esc(raw.post_name||'Sin centro')} · ${esc(raw.municipality||'')}</small></div><span class="pill pill-pending">Resumen mensual</span></div>${reviewChips(raw)}<div class="review-errors">${(item.errors||[]).map(error=>`<span class="review-error-chip">${esc(error)}</span>`).join('')}</div><div class="review-fields"><label>Empleado<select data-field="summary_employee_id" name="summary_employee_id"><option value="">Seleccionar</option>${state.employees.map(e=>`<option value="${esc(e.id)}" ${e.id===selected?'selected':''}>${esc(e.code)} · ${esc(`${e.first_name} ${e.last_name}`.trim())}</option>`).join('')}</select></label><label>Mes<input data-field="summary_month" name="summary_month" autocomplete="off" placeholder="2026-07" value="${esc(raw.month||'')}"></label><label>Horas totales<input data-field="summary_hours" name="summary_hours" autocomplete="off" placeholder="200 o 200:00" value="${esc(raw.hours||'')}"></label></div><div class="review-card-actions"><button class="button button-secondary" data-discard-review="${esc(item.id)}">Descartar</button><button class="button button-primary" data-resolve-summary="${esc(item.id)}">Guardar resumen</button></div></article>`;
    }
    const row=raw;
    const emp=state.employees.find(e=>e.id===row.employee_id);
    const post=state.posts.find(p=>p.id===row.post_id);
    const selectedEmployee=row.employee_id||state.employees.find(e=>e.code===row.employee_code)?.id||'';
    const selectedPost=row.post_id||state.posts.find(p=>p.code===row.post_code)?.id||'';
    return `<article class="review-card" data-review-card="${esc(item.id)}"><div class="review-card-head"><div class="review-source"><strong>${esc(item.source_label)}</strong><small>Revisa y completa los datos marcados; la previsualización no ha escrito nada.</small></div><span class="pill pill-pending">Revisión necesaria</span></div>${reviewChips(row)}<div class="review-errors">${(item.errors||[]).map(error=>`<span class="review-error-chip">${esc(error)}</span>`).join('')}</div><div class="review-fields"><label>Empleado<select data-field="employee_id" name="employee_id"><option value="">Seleccionar</option>${state.employees.map(e=>`<option value="${esc(e.id)}" ${e.id===selectedEmployee?'selected':''}>${esc(e.code)} · ${esc(`${e.first_name} ${e.last_name}`.trim())}</option>`).join('')}</select></label><label>Centro<select data-field="post_id" name="post_id"><option value="">Seleccionar</option>${state.posts.map(p=>`<option value="${esc(p.id)}" ${p.id===selectedPost?'selected':''}>${esc(p.code)} · ${esc(p.name)}</option>`).join('')}</select></label><label>Entrada<input data-field="start_at" name="start_at" type="datetime-local" autocomplete="off" value="${esc((row.start_at||'').slice(0,16))}"></label><label>Salida<input data-field="end_at" name="end_at" type="datetime-local" autocomplete="off" value="${esc((row.end_at||'').slice(0,16))}"></label><label>Espacio libre desde<input data-field="free_start_at" name="free_start_at" type="datetime-local" autocomplete="off" value="${esc((row.break_start_at&&!row.break_paid?row.break_start_at:'').slice(0,16))}"></label><label>Espacio libre hasta<input data-field="free_end_at" name="free_end_at" type="datetime-local" autocomplete="off" value="${esc((row.break_end_at&&!row.break_paid?row.break_end_at:'').slice(0,16))}"></label></div>${reviewRawDetails(row)}<div class="review-card-actions"><button class="button button-secondary" data-discard-review="${esc(item.id)}">Descartar</button><button class="button button-primary" data-resolve-review="${esc(item.id)}">Corregir y confirmar</button></div></article>`;
  }).join('');
}
async function reloadReview() { [state.review,state.duplicates]=await Promise.all([api('/api/review'),api('/api/duplicates')]); renderReview(); renderDuplicates(); }
function renderDuplicates(){
  const root=$('#duplicates-list'), heading=$('#duplicates-heading'); if(!root)return;
  const groups=state.duplicates||[];
  root.classList.toggle('hidden',!groups.length); if(heading)heading.classList.toggle('hidden',!groups.length);
  root.innerHTML=groups.map(g=>{const main=g.employees[0];return `<article class="review-card"><div class="review-card-head"><div class="review-source"><strong>${esc(g.name)}</strong><small>${esc(g.employees.map(e=>`${e.code} · ${e.shift_count} turno(s)`).join('  |  '))}</small></div><span class="pill pill-pending">Nombre duplicado</span></div><div class="review-card-actions">${g.employees.slice(1).map(e=>`<button class="button button-secondary" data-merge-keep="${esc(main.id)}" data-merge-source="${esc(e.id)}">Unificar ${esc(e.code)} → ${esc(main.code)}</button>`).join('')}</div></article>`;}).join('');
}
async function loadAll() { setMonthLabels();  await reloadBase(); await reloadReport();
}
function openDialog(id){const dialog=$(id);dialog.showModal();}
function closeDialogs(){ $$('dialog').forEach(d=>d.close()); }
function navigate(view){
  const aliases={inicio:'overview',cuadrante:'shifts',empleados:'employees',centros:'posts',puestos:'posts',revision:'review'};
  view=aliases[view]||view;
  const valid=['overview','shifts','employees','posts','review'];
  if(!valid.includes(view))return;
  $$('[data-page]').forEach(section=>section.classList.toggle('hidden',section.dataset.page!==view));
  $$('.nav-item').forEach(link=>link.classList.toggle('active',link.dataset.view===view));
  const labels={overview:'Resumen',shifts:'Cuadrante',employees:'Empleados',posts:'Centros',review:'Por revisar'};
  $('#breadcrumb-current').textContent=labels[view]; history.replaceState(null,'',`#${view==='overview'?'inicio':view==='posts'?'centros':view==='review'?'revision':view}`);
  $('#sidebar').classList.remove('open');
  if(view==='review')reloadReview();
}
function csvEscape(v){return `"${String(v??'').replaceAll('"','""')}"`;}
function exportCsv(){
  if(!state.report)return;
  const columns=['ID empleado','Empleado','ID centro','Centro','Entrada','Salida','Espacio libre desde','Espacio libre hasta','Horas trabajadas HH:MM','Horas nocturnas HH:MM','Horas festivas HH:MM'];
  const lines=[columns.map(csvEscape).join(';'),...state.report.shifts.map(s=>[s.employee_code,`${s.first_name} ${s.last_name}`.trim(),s.post_code||'',s.post_name,s.start_at,s.end_at,(s.break_start_at&&!s.break_paid?s.break_start_at:''),(s.break_end_at&&!s.break_paid?s.break_end_at:''),toHHMM(s.minutes),toHHMM(s.night_minutes),toHHMM(s.holiday_minutes)].map(csvEscape).join(';'))];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`cuadrante-${state.date.getFullYear()}-${String(state.date.getMonth()+1).padStart(2,'0')}.csv`;a.click();URL.revokeObjectURL(a.href);
}
async function previewAndImport(file){
  if(!file)return;
  const form=new FormData();form.append('file',file);
  try{
    const preview=await api('/api/imports/preview',{method:'POST',body:form});
    state.importPreview=preview;
    const summaries=preview.rows.filter(row=>row.kind==='summary').length;
    const ready=preview.ready||0, pending=preview.pending||0;
    $('#import-dialog-summary').textContent=`${preview.filename} · ${preview.count} fila${preview.count===1?'':'s'} · ${ready} lista${ready===1?'':'s'} · ${pending} con incidencias${summaries?` · ${summaries} resumen${summaries===1?'':'es'}`:''}.`;
    const sample=preview.rows.slice(0,7).map(row=>{
      if(row.kind==='summary')return `<div class="import-preview-row"><span class="import-preview-main"><strong>${esc(row.employee_label||row.employee_code||'Empleado')}</strong><small>Resumen mensual · ${esc(row.month||'')}</small></span><span class="pill pill-muted">${esc(row.hours||'')}</span></div>`;
      const status=row.status==='ready'?'<span class="pill pill-confirmed">Lista</span>':'<span class="pill pill-pending">Revisar</span>';
      return `<div class="import-preview-row"><span class="import-preview-main"><strong>${esc(row.employee_label||row.employee_code||'Empleado')}</strong><small>${esc(row.post_label||row.post_name||'Centro')} · ${esc((row.start_at||'').slice(0,10))} · ${esc(fmtTime(row.start_at))}–${esc(fmtTime(row.end_at))}</small></span>${status}</div>`;
    }).join('');
    $('#import-dialog-sample').innerHTML=sample+(preview.rows.length>7?`<div class="import-preview-more">+ ${preview.rows.length-7} fila(s) más</div>`:'');
    openDialog('#import-dialog');
  }catch(error){toast(error.message||'No se pudo importar el archivo.');}
}
async function confirmImportPreview(){
  const preview=state.importPreview; if(!preview)return;
  try{
    const result=await api('/api/imports/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:preview.rows,filename:preview.filename,source:preview.kind||'text'})});
    state.importPreview=null; closeDialogs(); await reloadBase(); await reloadReview(); await reloadReport();
    const parts=[];
    if(result.pending)parts.push(`${result.pending} turno(s) pendiente(s) de confirmación`);
    if(result.summaries)parts.push(`${result.summaries} resumen(es) mensual(es) guardado(s)`);
    if(result.needs_review)parts.push(`${result.needs_review} fila(s) requieren corrección`);
    toast(parts.length?parts.join('; ')+'.':'Importación completada sin cambios.');
    if(result.needs_review)navigate('review');
  }catch(error){toast(error.message||'No se pudo confirmar la importación.');}
}
$('#import-confirm').addEventListener('click',confirmImportPreview);
function localInputDateTime(dateObj,hour,minute='00') { return `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}T${hour}:${minute}`; }
function openShift(prefill={}){
  state.editingShift=prefill.id||null;$('#shift-form').reset();clearError($('#shift-error'));fillSelects();
  $('#shift-dialog h2').textContent=state.editingShift?'Editar turno':'Registrar turno';
  $('#shift-form button[type="submit"]').textContent=state.editingShift?'Guardar cambios':'Guardar turno';
  const d=prefill.date?new Date(`${prefill.date}T12:00:00`):new Date();
  $('#shift-start').value=prefill.start||localInputDateTime(d,'08','00');
  const endDate=new Date(d); if(prefill.startHour===22)endDate.setDate(endDate.getDate()+1);
  $('#shift-end').value=prefill.end||localInputDateTime(endDate,prefill.startHour===22?'06':'16','00');
  if(prefill.employee)$('#shift-employee').value=prefill.employee;
  if(prefill.post)$('#shift-post').value=prefill.post;
  $('#free-start').value=prefill.break_start_at&&!prefill.break_paid?prefill.break_start_at.slice(0,16):'';
  $('#free-end').value=prefill.break_end_at&&!prefill.break_paid?prefill.break_end_at.slice(0,16):'';
  state.customDays=[];renderCustomDays();$('#shift-custom-date').value='';
  $('#shift-repeat').value='none';$('#shift-repeat-until').value='';$('#repeat-until-wrap').classList.add('hidden');$('#custom-days-wrap').classList.add('hidden');
  $('#repeat-control').classList.toggle('hidden',Boolean(state.editingShift));
  updateRepeatHint();updateShiftHolidayHint();
  openDialog('#shift-dialog');
}
const sidebarCollapse=$('#sidebar-collapse');
const collapseQuery=window.matchMedia('(max-width:800px)');
function sidebarIsCollapsed(){return document.documentElement.classList.contains('sidebar-collapsed');}
function setSidebarCollapsed(collapsed,persist=true){
  document.documentElement.classList.toggle('sidebar-collapsed',collapsed);
  const label=collapsed?'Expandir menú lateral':'Comprimir menú lateral';
  if(sidebarCollapse){sidebarCollapse.setAttribute('aria-expanded',String(!collapsed));sidebarCollapse.setAttribute('title',label);const text=sidebarCollapse.querySelector('.collapse-label');const chevron=sidebarCollapse.querySelector('.collapse-chevron');if(text)text.textContent=collapsed?'Expandir menú':'Comprimir menú';if(chevron)chevron.textContent=collapsed?'›':'‹';}
  $('#menu-toggle')?.setAttribute('aria-expanded',String(!collapsed));
  if(persist){try{localStorage.setItem('centro-sidebar-collapsed',collapsed?'1':'0')}catch(e){}}
}
setSidebarCollapsed(sidebarIsCollapsed(),false);
sidebarCollapse?.addEventListener('click',()=>setSidebarCollapsed(!sidebarIsCollapsed()));
$('#menu-toggle').addEventListener('click',()=>{if(collapseQuery.matches){const sidebar=$('#sidebar');const open=sidebar.classList.toggle('open');$('#menu-toggle').setAttribute('aria-expanded',String(open));}else{setSidebarCollapsed(!sidebarIsCollapsed());}});
collapseQuery.addEventListener?.('change',()=>{if(!collapseQuery.matches){$('#sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded',String(!sidebarIsCollapsed()));}});
$$('.nav-item').forEach(link=>link.addEventListener('click',e=>{e.preventDefault();navigate(link.dataset.view)}));
$$('[data-navigate]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.navigate)));
$$('[data-open-shift]').forEach(button=>button.addEventListener('click',()=>openShift()));
$$('[data-close-dialog]').forEach(button=>button.addEventListener('click',closeDialogs));
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));
function stepPeriod(delta){const year=state.date.getFullYear();if(state.mode==='year'){state.date=new Date(year+delta,0,1);}else{state.date=new Date(year,state.date.getMonth()+delta,1);}}
$('#prev-month').addEventListener('click',async()=>{stepPeriod(-1);await reloadBase();await reloadReport()});
$('#next-month').addEventListener('click',async()=>{stepPeriod(1);await reloadBase();await reloadReport()});
$$('[data-month-step]').forEach(button=>button.addEventListener('click',async()=>{stepPeriod(Number(button.dataset.monthStep));await reloadBase();await reloadReport()}));
$$('#period-mode,.period-select').forEach(select=>select?.addEventListener('change',async()=>{state.mode=select.value;$$('#period-mode,.period-select').forEach(item=>{if(item)item.value=state.mode});await reloadReport()}));
$('#post-filter').addEventListener('change',reloadReport);
$('#clear-filters').addEventListener('click',()=>{$('#post-filter').value='';$('#employee-search').value='';$$('.post-select').forEach(el=>el.value='');reloadReport()});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();const search=$('#employee-search');if(search){search.focus();search.select();}}});
$$('.post-select').forEach(el=>el.addEventListener('change',e=>{ $('#post-filter').value=e.target.value;reloadReport();}));
let searchTimer;$('#employee-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(reloadReport,220)});
$('#employees-search').addEventListener('input',renderEmployees);
$('#employee-grid').addEventListener('click',e=>{const button=e.target.closest('.employee-report');if(button){navigate('overview');$('#employee-search').value=button.dataset.code;reloadReport()}});
function openEmployee(prefill={}){
  state.editingEmployee=prefill.id||null;const form=$('#employee-form');form.reset();clearError($('#employee-error'));
  form.elements.code.value=prefill.code||'';form.elements.first_name.value=prefill.first_name||'';form.elements.last_name.value=prefill.last_name||'';
  $('#employee-dialog h2').textContent=state.editingEmployee?'Editar empleado':'Añadir empleado';
  form.querySelector('button[type="submit"]').textContent=state.editingEmployee?'Guardar cambios':'Guardar empleado';
  openDialog('#employee-dialog');
}
function openPost(prefill={}){
  state.editingPost=prefill.id||null;const form=$('#post-form');form.reset();clearError($('#post-error'));
  form.elements.code.value=prefill.code||'';form.elements.name.value=prefill.name||'';
  $('#post-dialog h2').textContent=state.editingPost?'Editar centro':'Añadir centro';
  form.querySelector('button[type="submit"]').textContent=state.editingPost?'Guardar cambios':'Guardar centro';
  openDialog('#post-dialog');
}
$('#add-employee').addEventListener('click',()=>openEmployee());
$('#add-post').addEventListener('click',()=>openPost());
$('#employee-form').addEventListener('submit',async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget));try{await api(state.editingEmployee?`/api/employees/${state.editingEmployee}`:'/api/employees',{method:state.editingEmployee?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});const editing=Boolean(state.editingEmployee);state.editingEmployee=null;closeDialogs();await loadAll();toast(editing?'Empleado actualizado.':'Empleado guardado correctamente.')}catch(err){showError($('#employee-error'),err.message)}});
$('#post-form').addEventListener('submit',async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget));try{await api(state.editingPost?`/api/posts/${state.editingPost}`:'/api/posts',{method:state.editingPost?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});const editing=Boolean(state.editingPost);state.editingPost=null;closeDialogs();await loadAll();toast(editing?'Centro actualizado.':'Centro guardado correctamente.')}catch(err){showError($('#post-error'),err.message)}});
$('#employee-grid').addEventListener('click',async e=>{
  const edit=e.target.closest('[data-edit-employee]');const del=e.target.closest('[data-delete-employee]');
  const person=edit?state.employees.find(x=>x.id===edit.dataset.editEmployee):del?state.employees.find(x=>x.id===del.dataset.deleteEmployee):null;
  if(edit&&person){openEmployee(person);return;}
  if(del&&person){if(!window.confirm(`¿Eliminar a ${person.first_name} ${person.last_name}? Sus turnos históricos se conservan.`))return;try{await api(`/api/employees/${person.id}`,{method:'DELETE'});await loadAll();toast('Empleado eliminado del equipo activo.')}catch(err){toast(err.message)}}
});
$('#post-grid').addEventListener('click',async e=>{
  const edit=e.target.closest('[data-edit-post]');const del=e.target.closest('[data-delete-post]');
  const post=edit?state.posts.find(x=>x.id===edit.dataset.editPost):del?state.posts.find(x=>x.id===del.dataset.deletePost):null;
  if(edit&&post){openPost(post);return;}
  if(del&&post){if(!window.confirm(`¿Eliminar el centro ${post.name}? Los turnos históricos se conservan.`))return;try{await api(`/api/posts/${post.id}`,{method:'DELETE'});await loadAll();toast('Centro eliminado de la operación activa.')}catch(err){toast(err.message)}}
});
$('#shift-form').addEventListener('submit',async e=>{e.preventDefault();clearError($('#shift-error'));const freeStart=$('#free-start').value||null;const freeEnd=$('#free-end').value||null;const repeatMode=$('#shift-repeat').value;const repeatUntil=$('#shift-repeat-until').value;if(Boolean(freeStart)!==Boolean(freeEnd)){showError($('#shift-error'),'Indica desde y hasta del espacio libre, o deja ambos vacíos.');return;}if(!state.editingShift&&repeatMode!=='none'&&repeatMode!=='custom'&&!repeatUntil){showError($('#shift-error'),'Indica hasta qué fecha quieres repetir el turno.');return;}if(!state.editingShift&&repeatMode==='custom'&&!state.customDays.length){showError($('#shift-error'),'Selecciona al menos un día concreto para la repetición esporádica.');return;}const data={employee_id:$('#shift-employee').value,post_id:$('#shift-post').value,start_at:$('#shift-start').value,end_at:$('#shift-end').value,break_start_at:freeStart,break_end_at:freeEnd,break_paid:false};if(!state.editingShift){data.repeat_mode=repeatMode;if(repeatMode==='custom')data.repeat_dates=[...state.customDays];else data.repeat_until=repeatUntil||null;}try{const result=await api(state.editingShift?`/api/shifts/${state.editingShift}`:'/api/shifts',{method:state.editingShift?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});closeDialogs();await loadAll();await reloadReview();if(state.editingShift){toast('Turno actualizado.')}else if(result.created>1){toast(`${result.created} turnos guardados y sumados a los totales.${result.skipped?` ${result.skipped} ya existían.`:''}`)}else if(result.created===0){toast(`No se creó ningún turno: ${result.skipped} ya existían.`)}else{toast('Turno guardado y sumado a los totales.')}state.editingShift=null;}catch(err){showError($('#shift-error'),err.message)}});
function renderCustomDays(){const root=$('#custom-day-list');if(!root)return;root.innerHTML=state.customDays.map(day=>`<span class="custom-day-chip">${esc(commentedDate(day,true))}<button type="button" data-remove-custom-day="${esc(day)}" aria-label="Quitar ${esc(day)}">×</button></span>`).join('')||'<small class="custom-day-empty">Aún no has añadido días concretos.</small>';}
function updateRepeatHint(){const mode=$('#shift-repeat').value;const wrap=$('#repeat-until-wrap');const customWrap=$('#custom-days-wrap');const hint=$('#repeat-hint');wrap.classList.toggle('hidden',mode==='none'||mode==='custom');customWrap.classList.toggle('hidden',mode!=='custom');if(mode==='none'){hint.textContent='Elige una repetición para crear varios turnos con el mismo horario.';return;}if(mode==='custom'){hint.textContent=state.customDays.length?`Se crearán ${state.customDays.length} turno${state.customDays.length===1?'':'s'} en los días seleccionados.`:'Añade los días concretos en los que el empleado trabaja en este centro.';return;}const start=$('#shift-start').value;const until=$('#shift-repeat-until').value;if(!start||!until){hint.textContent='Indica la fecha final para ver cuántos turnos se crearán.';return;}const first=new Date(`${start.slice(0,10)}T12:00:00`);const last=new Date(`${until}T12:00:00`);if(last<first){hint.textContent='La fecha final debe ser igual o posterior a la entrada.';return;}let count=0;const cursor=new Date(first);while(cursor<=last){const weekday=cursor.getDay();if(mode==='daily'||(mode==='weekdays'&&weekday>=1&&weekday<=5)||(mode==='weekly'&&weekday===first.getDay()))count++;cursor.setDate(cursor.getDate()+1);}hint.textContent=count?`Se crearán ${count} turno${count===1?'':'s'} con este horario.`:'La repetición no genera ningún día en ese rango.';}
function updateShiftHolidayHint(){const hint=$('#shift-holiday-hint');if(!hint)return;const post=state.posts.find(p=>p.id===$('#shift-post').value);const names=post?holidayNamesForRange(post.municipality,$('#shift-start').value,$('#shift-end').value):[];hint.classList.toggle('hidden',!names.length);hint.textContent=names.length?`Festivo: ${names.join(', ')}. Las horas festivas se calcularán automáticamente.`:'';}
$('#shift-repeat').addEventListener('change',updateRepeatHint);
$('#shift-repeat-until').addEventListener('change',updateRepeatHint);
$('#shift-start').addEventListener('change',updateRepeatHint);
$('#shift-start').addEventListener('change',updateShiftHolidayHint);
$('#shift-end').addEventListener('change',updateShiftHolidayHint);
$('#shift-post').addEventListener('change',updateShiftHolidayHint);
$('#add-custom-day').addEventListener('click',()=>{const input=$('#shift-custom-date');const day=input.value;if(!day)return toast('Selecciona una fecha.');if(day<$('#shift-start').value.slice(0,10))return toast('El día debe ser igual o posterior a la entrada.');if(!state.customDays.includes(day)){state.customDays.push(day);state.customDays.sort();}input.value='';renderCustomDays();updateRepeatHint();});
$('#custom-day-list').addEventListener('click',e=>{const button=e.target.closest('[data-remove-custom-day]');if(!button)return;state.customDays=state.customDays.filter(day=>day!==button.dataset.removeCustomDay);renderCustomDays();updateRepeatHint();});
function exportQuery(){const params=new URLSearchParams({year:String(state.date.getFullYear())});if(state.mode==='month')params.set('month',String(state.date.getMonth()+1));if(selectedPost())params.set('post_id',selectedPost());return params;}
$('#export-file').addEventListener('click',()=>{const format=$('#export-format').value==='csv'?'csv':'xlsx';window.location.href=`/api/exports/shifts.${format}?${exportQuery()}`});
$('#choose-csv').addEventListener('click',()=>$('#csv-file').click());
$('#csv-file').addEventListener('change',e=>{previewAndImport(e.target.files[0]);e.target.value=''});
$$('.csv-inline').forEach(input=>input.addEventListener('change',e=>{previewAndImport(e.target.files[0]);e.target.value=''}));
$('#drop-zone').addEventListener('dragover',e=>{e.preventDefault();e.currentTarget.classList.add('dragging')});$('#drop-zone').addEventListener('dragleave',e=>e.currentTarget.classList.remove('dragging'));$('#drop-zone').addEventListener('drop',e=>{e.preventDefault();e.currentTarget.classList.remove('dragging');previewAndImport(e.dataTransfer.files[0])});
$('#drop-zone').addEventListener('click',e=>{if(e.target.closest('button'))return;$('#csv-file').click()});
$('#review-list').addEventListener('click',async e=>{
  const confirm=e.target.closest('[data-confirm-shift]');const discardShift=e.target.closest('[data-discard-shift]');const editPending=e.target.closest('[data-edit-pending]');const resolve=e.target.closest('[data-resolve-review]');const resolveSummary=e.target.closest('[data-resolve-summary]');const discard=e.target.closest('[data-discard-review]');
  try{
    if(editPending){const item=state.review.find(entry=>entry.shift?.id===editPending.dataset.editPending);if(item){const s=item.shift;openShift({id:s.id,employee:s.employee_id,post:s.post_id,start:s.start_at.slice(0,16),end:s.end_at.slice(0,16),break_start_at:s.break_start_at,break_end_at:s.break_end_at,break_paid:Boolean(s.break_paid)});}return;}
    if(confirm){await api(`/api/shifts/${confirm.dataset.confirmShift}/confirm`,{method:'POST'});toast('Turno confirmado y contabilizado.')}
    if(discardShift){await api(`/api/shifts/${discardShift.dataset.discardShift}`,{method:'DELETE'});toast('Turno pendiente descartado.')}
    if(discard){await api(`/api/review/${discard.dataset.discardReview}`,{method:'DELETE'});toast('Fila descartada.')}
    if(resolveSummary){const card=resolveSummary.closest('[data-review-card]');const value=(name)=>card.querySelector(`[data-field="${name}"]`)?.value||'';const employeeId=value('summary_employee_id');if(!employeeId){toast('Selecciona el empleado del resumen.');return;}const data={employee_id:employeeId,month:value('summary_month'),hours:value('summary_hours')};await api(`/api/review/${resolveSummary.dataset.resolveSummary}/resolve-summary`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});toast('Resumen mensual corregido y guardado.')}
    if(resolve){const card=resolve.closest('[data-review-card]');const value=(name)=>card.querySelector(`[data-field="${name}"]`)?.value||'';const employeeId=value('employee_id');const postId=value('post_id');if(!employeeId||!postId){toast('Selecciona el empleado y el centro antes de confirmar.');return;}const freeStart=value('free_start_at');const freeEnd=value('free_end_at');if(Boolean(freeStart)!==Boolean(freeEnd)){toast('Indica desde y hasta del espacio libre.');return;}const data={employee_id:employeeId,post_id:postId,start_at:value('start_at'),end_at:value('end_at'),break_start_at:freeStart||null,break_end_at:freeEnd||null,break_paid:false};await api(`/api/review/${resolve.dataset.resolveReview}/resolve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});toast('Fila corregida y confirmada.')}
    await reloadBase();await reloadReport();
  }catch(err){toast(err.message)}
});
$('#duplicates-list').addEventListener('click',async e=>{const button=e.target.closest('[data-merge-source]');if(!button)return;if(!window.confirm('¿Unificar los turnos y resúmenes del empleado repetido en el principal? El ID duplicado se eliminará.'))return;try{const result=await api(`/api/employees/${button.dataset.mergeKeep}/merge`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_id:button.dataset.mergeSource})});await loadAll();await reloadReview();toast(`Empleado unificado: ${result.merged_shifts} turno(s) movidos.`)}catch(error){toast(error.message)}});
$('#holiday-list').addEventListener('click',async e=>{const button=e.target.closest('[data-delete-holiday]');if(!button)return;try{await api(`/api/holidays/${button.dataset.deleteHoliday}`,{method:'DELETE'});await reloadBase();await reloadReport();toast('Festivo eliminado.')}catch(error){toast(error.message)}});
$('#summaries-body').addEventListener('click',async e=>{const button=e.target.closest('[data-delete-summary]');if(!button)return;try{await api(`/api/monthly-summaries/${button.dataset.deleteSummary}`,{method:'DELETE'});await reloadReport();toast('Resumen mensual eliminado.')}catch(error){toast(error.message)}});
$('#add-holiday').addEventListener('click',()=>{const municipality=$('#holiday-municipality');municipality.innerHTML='<option value="">Selecciona municipio</option>'+[...new Set(state.posts.map(p=>p.municipality))].sort().map(m=>`<option>${esc(m)}</option>`).join('');$('#holiday-form').reset();$('#holiday-error').classList.add('hidden');openDialog('#holiday-dialog')});
$('#holiday-form').addEventListener('submit',async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget));try{await api('/api/holidays',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});closeDialogs();await reloadBase();await reloadReport();toast('Festivo guardado para ese municipio.')}catch(error){showError($('#holiday-error'),error.message)}});
$('#shifts-view').addEventListener('click',async e=>{
  const edit=e.target.closest('[data-edit-shift]');
  if(edit){const shift=state.report.shifts.find(item=>item.id===edit.dataset.editShift);if(shift)openShift({id:shift.id,employee:shift.employee_id,post:shift.post_id,start:shift.start_at.slice(0,16),end:shift.end_at.slice(0,16),break_start_at:shift.break_start_at,break_end_at:shift.break_end_at,break_paid:Boolean(shift.break_paid)});return;}
  const review=e.target.closest('[data-review-shift]');
  if(review){await sendShiftsToReview([review.dataset.reviewShift]);}
});
$('#shifts-view').addEventListener('change',e=>{
  const select=e.target.closest('[data-select-shift]');
  if(select){select.checked?state.selectedShifts.add(select.dataset.selectShift):state.selectedShifts.delete(select.dataset.selectShift);syncShiftSelection();return;}
  const all=e.target.closest('.select-all-shifts');
  if(all){const ids=(state.report?.shifts||[]).map(s=>s.id);state.selectedShifts=new Set(all.checked?ids:[]);syncShiftSelection();return;}
  const field=e.target.closest('#excel-body [data-field]');
  if(field){const row=field.closest('tr');row.classList.add('dirty');if(field.dataset.field==='date'){const label=row.querySelector('.date-weekday');if(label)label.textContent=commentedDate(field.value);}}
});
$('#toggle-excel').addEventListener('click',()=>{if(state.mode==='year')return;state.excelView=!state.excelView;updateShiftView();syncShiftSelection();});
$('#excel-save').addEventListener('click',saveExcelChanges);
$('#bulk-clear').addEventListener('click',()=>{state.selectedShifts.clear();syncShiftSelection();});
$('#bulk-review').addEventListener('click',()=>sendShiftsToReview([...state.selectedShifts]));
$('#help-button').addEventListener('click',()=>toast('Centro de administración de personal de seguridad privada. Aplicación local: festivos por municipio y turnos importados que debes confirmar antes de calcular informes.'));
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#employee-search').focus()}if(e.key==='Escape')$('#sidebar').classList.remove('open')});
window.addEventListener('hashchange',()=>navigate(location.hash.replace('#','')==='inicio'?'overview':location.hash.slice(1)));
(async()=>{try{await loadAll();const requested=location.hash.replace('#','');navigate(requested==='inicio'?'overview':(requested||'overview'));}catch(error){toast(`No se pudo iniciar: ${error.message}`)}})();
