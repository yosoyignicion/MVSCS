const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { date: new Date(), mode: 'month', employees: [], posts: [], report: null, review: [], duplicates: [], holidays: [], editingShift: null, toastTimer: null };
const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = (value) => new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short'}).format(new Date(`${value.slice(0,10)}T12:00:00`)).replace('.', '');
const fmtTime = (value) => value ? value.slice(11,16) : '—';
const initials = (name) => name.trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
const monthStart = () => `${state.date.getFullYear()}-${String(state.date.getMonth()+1).padStart(2,'0')}-01`;
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
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try { const body = await response.json(); message = typeof body.detail === 'string' ? body.detail : (body.detail?.message || message); } catch {}
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
async function reloadBase() {
  [state.employees,state.posts,state.review,state.holidays] = await Promise.all([api('/api/employees?limit=5000'),api('/api/posts'),api('/api/review'),api(`/api/holidays?year=${state.date.getFullYear()}`)]);
  fillSelects(); renderEmployees(); renderPosts(); renderReview(); renderHolidays();
}
function fillSelects() {
  const opts = state.posts.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.municipality)}</option>`).join('');
  ['#post-filter', ...$$('.post-select').map(el=>`#${el.id}`).filter(Boolean)].forEach(selector=>{
    const el=$(selector); if (!el) return; const old=el.value;
    el.innerHTML='<option value="">Todos los puestos</option>'+opts; if(old)el.value=old;
  });
  const shiftPost=$('#shift-post'); shiftPost.innerHTML='<option value="">Selecciona puesto</option>'+opts;
  const shiftEmployee=$('#shift-employee'); shiftEmployee.innerHTML='<option value="">Selecciona empleado</option>'+state.employees.map(e=>`<option value="${esc(e.id)}">${esc(e.code)} · ${esc(`${e.first_name} ${e.last_name}`.trim())}</option>`).join('');
}
async function reloadReport() {
  setMonthLabels();
  const post = selectedPost(); const search = $('#employee-search').value.trim();
  const params = new URLSearchParams({year:String(state.date.getFullYear())});
  if(state.mode==='month')params.set('month',String(state.date.getMonth()+1)); if(post)params.set('post_id',post); if(search)params.set('q',search);
  if(state.mode==='year')params.set('group_by_employee','false');
  state.report=await api(`/api/reports?${params}`);
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
  const displayShifts=state.mode==='year'?(report.days||[]).map(day=>({id:day.date,employee_code:`${day.shift_count} turnos`,first_name:'Total diario',last_name:'',post_name:'Todos los puestos',municipality:'Comunitat Valenciana',province:'',start_at:`${day.date}T00:00`,end_at:`${day.date}T00:00`,minutes:day.minutes,night_minutes:day.night_minutes,holiday_minutes:day.holiday_minutes})):report.shifts;
  body.innerHTML=displayShifts.slice(0,250).map(s=>{
    const duration=toHHMM(s.minutes); const classes=[];
    if(s.night_minutes)classes.push(`<span class="pill pill-night">☾ ${toHHMM(s.night_minutes)}</span>`);
    if(s.holiday_minutes)classes.push(`<span class="pill pill-holiday">✳ ${toHHMM(s.holiday_minutes)}</span>`);
    return `<tr><td><div class="employee-cell"><span class="employee-avatar">${esc(initials(`${s.first_name} ${s.last_name}`))}</span><span class="employee-name"><strong>${esc(`${s.first_name} ${s.last_name}`.trim())}</strong><small>${esc(s.employee_code)}</small></span></div></td><td><span class="post-cell"><strong>${esc(s.post_name)}</strong><small>${esc(s.municipality)} · ${esc(s.province)}</small></span></td><td><span class="date-cell">${esc(fmtDate(s.start_at))}<small>${esc(new Intl.DateTimeFormat('es-ES',{weekday:'short'}).format(new Date(`${s.start_at.slice(0,10)}T12:00:00`)))}</small></span></td><td><span class="time-cell">${esc(fmtTime(s.start_at))} — ${esc(fmtTime(s.end_at))}</span></td><td><span class="duration-cell">${toHHMM(s.minutes)}</span></td><td>${s.night_minutes?`<span class="pill pill-night">${toHHMM(s.night_minutes)}</span>`:'<span class="pill pill-muted">—</span>'}</td><td>${s.holiday_minutes?`<span class="pill pill-holiday">${toHHMM(s.holiday_minutes)}</span>`:'<span class="pill pill-muted">—</span>'}</td><td><span class="pill pill-confirmed">● Confirmado</span></td></tr>`;
  }).join('');
  const empty=displayShifts.length===0; $('#activity-empty').classList.toggle('hidden',!empty); $('#activity-body').closest('.table-scroll').classList.toggle('hidden',empty); $('.table-footer').classList.toggle('hidden',empty);
  renderHolidays();
  renderPostsSummary(report.posts,report.totals.minutes); renderShiftTable(report); renderSummaries(report.summaries);
}
function renderSummaries(summaries){
  const card=$('#summaries-card'), heading=$('#summaries-heading'); if(!card)return;
  const rows=summaries||[]; card.classList.toggle('hidden',!rows.length); heading.classList.toggle('hidden',!rows.length);
  $('#summaries-body').innerHTML=rows.map(s=>`<tr><td><div class="employee-cell"><span class="employee-name"><strong>${esc(s.name||s.employee_code)}</strong><small>${esc(s.employee_code)}</small></span></div></td><td>${esc(s.month)}</td><td><strong class="duration-cell">${esc(s.hours)}</strong></td><td><span class="pill pill-muted">${esc(s.source_label||'importado')}</span></td><td><button class="text-button" data-delete-summary="${esc(s.id)}">Eliminar</button></td></tr>`).join('');
}
function toHHMM(minutes) { return `${String(Math.floor((minutes||0)/60)).padStart(2,'0')}:${String((minutes||0)%60).padStart(2,'0')}`; }
function renderPostsSummary(posts,total) {
  const root=$('#post-summary');
  if(!posts.length){root.innerHTML='<p class="subheading">Todavía no hay datos para mostrar.</p>';return;}
  root.innerHTML=posts.slice(0,5).map(p=>`<div><div class="post-row-head"><span>${esc(p.name)} <span style="color:#5f6b78">· ${esc(p.municipality)}</span></span><strong>${esc(p.hours)}</strong></div><div class="progress-track"><div class="progress-value" style="width:${total?Math.max(3,Math.round(100*p.minutes/total)):0}%"></div></div></div>`).join('');
}
function renderShiftTable(report) {
  const body=$('#shifts-body');
  const rows=state.mode==='year'?(report.days||[]).map(day=>({id:null,employee_code:`${day.shift_count} turnos`,first_name:'Total diario',last_name:'',post_name:'Todos los puestos',municipality:'Comunitat Valenciana',start_at:`${day.date}T00:00`,end_at:`${day.date}T00:00`,minutes:day.minutes,night_minutes:day.night_minutes,holiday_minutes:day.holiday_minutes})):report.shifts;
  body.innerHTML=rows.slice(0,1000).map(s=>`<tr><td><div class="employee-cell"><span class="employee-avatar">${esc(initials(`${s.first_name} ${s.last_name}`))}</span><span class="employee-name"><strong>${esc(`${s.first_name} ${s.last_name}`.trim())}</strong><small>${esc(s.employee_code)}</small></span></div></td><td><span class="post-cell"><strong>${esc(s.post_name)}</strong><small>${esc(s.municipality)}</small></span></td><td>${esc(s.start_at.slice(0,10))}</td><td><span class="time-cell">${state.mode==='year'?'—':`${esc(fmtTime(s.start_at))} — ${esc(fmtTime(s.end_at))}`}</span></td><td>${state.mode==='year'?'—':(s.break_start_at?`${esc(fmtTime(s.break_start_at))}–${esc(fmtTime(s.break_end_at))}${s.break_paid?' · pagada':''}`:'—')}</td><td><strong class="duration-cell">${toHHMM(s.minutes)}</strong></td><td>${toHHMM(s.night_minutes)}</td><td>${toHHMM(s.holiday_minutes)}</td><td>${state.mode==='year'?'—':`<button class="shift-edit" data-edit-shift="${esc(s.id)}">Editar</button>`}</td></tr>`).join('');
  $('#shifts-empty').classList.toggle('hidden',rows.length>0);
  $('#shifts-body').closest('.table-scroll').classList.toggle('hidden',rows.length===0);
}
function renderEmployees() {
  const q=($('#employees-search')?.value||'').trim().toLocaleLowerCase('es');
  const people=state.employees.filter(e=>`${e.code} ${e.first_name} ${e.last_name}`.toLocaleLowerCase('es').includes(q));
  $('#employee-total').textContent=`${people.length} empleado${people.length===1?'':'s'}`;
  $('#employee-grid').innerHTML=people.map(e=>`<article class="person-card"><div class="person-card-top"><span class="employee-avatar">${esc(initials(`${e.first_name} ${e.last_name}`))}</span><span class="employee-name"><strong>${esc(`${e.first_name} ${e.last_name}`.trim())}</strong><small>Vigilante de seguridad</small></span><span class="person-card-code">${esc(e.code)}</span></div><div class="person-metrics"><span class="person-metric"><strong data-emp-hours="${esc(e.id)}">—</strong><small>HORAS MES</small></span><span class="person-metric"><strong data-emp-night="${esc(e.id)}">—</strong><small>NOCTURNAS</small></span><span class="person-metric"><strong data-emp-holiday="${esc(e.id)}">—</strong><small>FESTIVAS</small></span></div><button class="text-button employee-report" data-code="${esc(e.code)}">Ver actividad →</button></article>`).join('') || '<div class="table-empty"><strong>No hay empleados coincidentes</strong></div>';
  for(const e of people){
    const row=state.report?.employees.find(item=>item.employee_id===e.id);
    const hours=$(`[data-emp-hours="${CSS.escape(e.id)}"]`); if(hours)hours.textContent=row?.hours||'00:00';
    const night=$(`[data-emp-night="${CSS.escape(e.id)}"]`); if(night)night.textContent=row?.night_hours||'00:00';
    const holiday=$(`[data-emp-holiday="${CSS.escape(e.id)}"]`); if(holiday)holiday.textContent=row?.holiday_hours||'00:00';
  }
}
function renderPosts() {
  $('#post-grid').innerHTML=state.posts.map(p=>`<article class="post-card"><div class="post-card-top"><span class="stat-icon icon-green">⌖</span><span class="employee-name"><strong>${esc(p.name)}</strong><small>Puesto de vigilancia</small></span></div><p class="post-location">${esc(p.municipality)} · ${esc(p.province)}</p><div class="post-card-foot">Festivos aplicados por municipio · Calendario manual</div></article>`).join('') || '<div class="table-empty"><strong>Aún no hay puestos</strong><small>Añade una instalación para empezar.</small></div>';
}
async function reloadHolidays(){state.holidays=await api(`/api/holidays?year=${state.date.getFullYear()}`);renderHolidays();}
function renderHolidays(){const root=$('#holiday-list');if(!root)return;const rows=(state.holidays||[]).filter(h=>state.mode==='year'||Number(h.date.slice(5,7))===state.date.getMonth()+1);root.innerHTML=rows.map(h=>`<div class="holiday-row"><strong>${esc(h.date)}</strong><span>${esc(h.name)}</span><small>${esc(h.municipality)}</small><button type="button" aria-label="Eliminar festivo" data-delete-holiday="${esc(h.id)}">Eliminar</button></div>`).join('')||'<p class="subheading">No hay festivos para este periodo. Se cargan los estatales y autonómicos; revisa y añade los locales de cada municipio.</p>';}

function renderReview() {
  const root=$('#review-list'); const items=state.review||[];
  $('#review-count').textContent=String(items.length);
  const has=items.length>0; $('#review-empty').classList.toggle('hidden',has); root.classList.toggle('hidden',!has);
  root.innerHTML=items.map(item=>{
    if(item.kind==='shift'){
      const s=item.shift;
      return `<article class="review-card"><div class="review-card-head"><div class="review-source"><strong>${esc(s.employee_code)} · ${esc(`${s.first_name} ${s.last_name}`.trim())}</strong><small>${esc(s.source_label||'Importación CSV')} · ${esc(s.post_name)} · ${esc(s.municipality)} · ${esc(s.start_at.slice(0,10))} · ${esc(fmtTime(s.start_at))}–${esc(fmtTime(s.end_at))}</small></div><span class="pill pill-pending">Pendiente de confirmar</span></div><div class="review-card-actions"><button class="button button-secondary" data-discard-shift="${esc(s.id)}">Descartar</button><button class="button button-primary" data-confirm-shift="${esc(s.id)}">Confirmar turno</button></div></article>`;
    }
    const raw=item.raw||{}; const row=raw;
    const emp=state.employees.find(e=>e.id===row.employee_id);
    const post=state.posts.find(p=>p.id===row.post_id);
    return `<article class="review-card" data-review-card="${esc(item.id)}"><div class="review-card-head"><div class="review-source"><strong>${esc(item.source_label)}</strong><small>La fila necesita que completes o corrijas los campos.</small></div><span class="pill pill-pending">Revisión necesaria</span></div><div class="review-errors">${(item.errors||[]).map(esc).join('<br>')}</div><div class="review-fields"><label>Empleado<select data-field="employee_id"><option value="">Seleccionar</option>${state.employees.map(e=>`<option value="${esc(e.id)}" ${e.id===row.employee_id?'selected':''}>${esc(e.code)} · ${esc(`${e.first_name} ${e.last_name}`.trim())}</option>`).join('')}</select></label><label>Puesto<select data-field="post_id"><option value="">Seleccionar</option>${state.posts.map(p=>`<option value="${esc(p.id)}" ${p.id===row.post_id?'selected':''}>${esc(p.name)} · ${esc(p.municipality)}</option>`).join('')}</select></label><label>Entrada<input data-field="start_at" type="datetime-local" autocomplete="off" value="${esc(row.start_at||'')}"></label><label>Salida<input data-field="end_at" type="datetime-local" autocomplete="off" value="${esc(row.end_at||'')}"></label><label>Inicio pausa<input data-field="break_start_at" type="datetime-local" autocomplete="off" value="${esc(row.break_start_at||'')}"></label><label>Fin pausa<input data-field="break_end_at" type="datetime-local" autocomplete="off" value="${esc(row.break_end_at||'')}"></label><label>Pausa remunerada<select data-field="break_paid"><option value="false" ${row.break_paid===false?'selected':''}>No</option><option value="true" ${row.break_paid===true?'selected':''}>Sí</option></select></label></div><div class="review-card-actions"><button class="button button-secondary" data-discard-review="${esc(item.id)}">Descartar</button><button class="button button-primary" data-resolve-review="${esc(item.id)}">Corregir y confirmar</button></div></article>`;
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
  const valid=['overview','shifts','employees','posts','review'];
  if(!valid.includes(view))return;
  $$('[data-page]').forEach(section=>section.classList.toggle('hidden',section.dataset.page!==view));
  $$('.nav-item').forEach(link=>link.classList.toggle('active',link.dataset.view===view));
  const labels={overview:'Resumen',shifts:'Cuadrante',employees:'Empleados',posts:'Puestos',review:'Por revisar'};
  $('#breadcrumb-current').textContent=labels[view]; history.replaceState(null,'',`#${view==='overview'?'inicio':view}`);
  $('#sidebar').classList.remove('open');
  if(view==='review')reloadReview();
}
function csvEscape(v){return `"${String(v??'').replaceAll('"','""')}"`;}
function exportCsv(){
  if(!state.report)return;
  const columns=['ID empleado','Empleado','Puesto','Municipio','Provincia','Entrada','Salida','Inicio pausa','Fin pausa','Pausa remunerada','Horas trabajadas HH:MM','Horas nocturnas HH:MM','Horas festivas HH:MM'];
  const lines=[columns.map(csvEscape).join(';'),...state.report.shifts.map(s=>[s.employee_code,`${s.first_name} ${s.last_name}`.trim(),s.post_name,s.municipality,s.province,s.start_at,s.end_at,s.break_start_at||'',s.break_end_at||'',s.break_paid?'Sí':'No',toHHMM(s.minutes),toHHMM(s.night_minutes),toHHMM(s.holiday_minutes)].map(csvEscape).join(';'))];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`cuadrante-${state.date.getFullYear()}-${String(state.date.getMonth()+1).padStart(2,'0')}.csv`;a.click();URL.revokeObjectURL(a.href);
}
async function previewAndImport(file){
  if(!file)return;
  const form=new FormData();form.append('file',file);
  try{const preview=await api('/api/imports/preview',{method:'POST',body:form});
    const rows=preview.rows.map(row=>({...row,break_paid:row.break_paid??false}));
    const result=await api('/api/imports/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows,filename:preview.filename,source:preview.kind||'csv'})});
    await reloadReview(); await reloadReport();
    const parts=[];
    if(result.pending)parts.push(`${result.pending} turno(s) pendiente(s) de confirmación`);
    if(result.summaries)parts.push(`${result.summaries} resumen(es) mensual(es) guardado(s)`);
    if(result.needs_review)parts.push(`${result.needs_review} fila(s) requieren corrección`);
    toast(parts.length?parts.join('; ')+'.':'Importación completada sin cambios.');
    if(result.needs_review)navigate('review');
  }catch(error){toast(error.message||'No se pudo importar el archivo.');}
}
function localInputDateTime(dateObj,hour,minute='00') { return `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}T${hour}:${minute}`; }
function openShift(prefill={}){
  state.editingShift=prefill.id||null;$('#shift-form').reset();clearError($('#shift-error'));fillSelects();
  $('#shift-dialog h2').textContent=state.editingShift?'Editar turno':'Registrar turno';
  $('#shift-form button[type="submit"]').textContent=state.editingShift?'Guardar cambios':'Guardar turno';
  $('#break-paid-label')?.classList.toggle('hidden',!prefill.hasBreak && !prefill.break_start_at);
  const d=prefill.date?new Date(`${prefill.date}T12:00:00`):new Date();
  $('#shift-start').value=prefill.start||localInputDateTime(d,'08','00');
  const endDate=new Date(d); if(prefill.startHour===22)endDate.setDate(endDate.getDate()+1);
  $('#shift-end').value=prefill.end||localInputDateTime(endDate,prefill.startHour===22?'06':'16','00');
  if(prefill.employee)$('#shift-employee').value=prefill.employee;
  if(prefill.post)$('#shift-post').value=prefill.post;
  if(prefill.break_start_at){$('#break-start').value=prefill.break_start_at.slice(0,16);$('#break-end').value=prefill.break_end_at.slice(0,16);$('#break-paid').value=String(Boolean(prefill.break_paid));$('#break-paid-label').classList.remove('hidden');}
  openDialog('#shift-dialog');
}
$('#menu-toggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$$('.nav-item').forEach(link=>link.addEventListener('click',e=>{e.preventDefault();navigate(link.dataset.view)}));
$$('[data-navigate]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.navigate)));
$$('[data-open-shift]').forEach(button=>button.addEventListener('click',()=>openShift()));
$$('[data-close-dialog]').forEach(button=>button.addEventListener('click',closeDialogs));
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));
$('#prev-month').addEventListener('click',async()=>{state.mode==='year'?state.date.setFullYear(state.date.getFullYear()-1):state.date.setMonth(state.date.getMonth()-1);await reloadBase();await reloadReport()});
$('#next-month').addEventListener('click',async()=>{state.mode==='year'?state.date.setFullYear(state.date.getFullYear()+1):state.date.setMonth(state.date.getMonth()+1);await reloadBase();await reloadReport()});
$$('[data-month-step]').forEach(button=>button.addEventListener('click',async()=>{state.mode==='year'?state.date.setFullYear(state.date.getFullYear()+Number(button.dataset.monthStep)):state.date.setMonth(state.date.getMonth()+Number(button.dataset.monthStep));await reloadBase();await reloadReport()}));
$$('#period-mode,.period-select').forEach(select=>select?.addEventListener('change',async()=>{state.mode=select.value;$$('#period-mode,.period-select').forEach(item=>{if(item)item.value=state.mode});await reloadReport()}));
$('#post-filter').addEventListener('change',reloadReport);
$$('.post-select').forEach(el=>el.addEventListener('change',e=>{ $('#post-filter').value=e.target.value;reloadReport();}));
let searchTimer;$('#employee-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(reloadReport,220)});
$('#employees-search').addEventListener('input',renderEmployees);
$('#employee-grid').addEventListener('click',e=>{const button=e.target.closest('.employee-report');if(button){navigate('overview');$('#employee-search').value=button.dataset.code;reloadReport()}});
$('#add-employee').addEventListener('click',()=>{ $('#employee-form').reset();clearError($('#employee-error'));openDialog('#employee-dialog')});
$('#add-post').addEventListener('click',()=>{ $('#post-form').reset();clearError($('#post-error'));openDialog('#post-dialog')});
$('#employee-form').addEventListener('submit',async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget));try{await api('/api/employees',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});closeDialogs();await loadAll();toast('Empleado guardado correctamente.')}catch(err){showError($('#employee-error'),err.message)}});
$('#post-form').addEventListener('submit',async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget));try{await api('/api/posts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});closeDialogs();await loadAll();toast('Puesto guardado correctamente.')}catch(err){showError($('#post-error'),err.message)}});
$('#shift-form').addEventListener('submit',async e=>{e.preventDefault();clearError($('#shift-error'));const breakStart=$('#break-start').value||null;const data={employee_id:$('#shift-employee').value,post_id:$('#shift-post').value,start_at:$('#shift-start').value,end_at:$('#shift-end').value,break_start_at:breakStart,break_end_at:$('#break-end').value||null,break_paid:breakStart?$('#break-paid').value==='true':false};try{await api(state.editingShift?`/api/shifts/${state.editingShift}`:'/api/shifts',{method:state.editingShift?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});closeDialogs();await loadAll();toast(state.editingShift?'Turno actualizado.':'Turno guardado y sumado a los totales.');state.editingShift=null;}catch(err){showError($('#shift-error'),err.message)}});
$('#export-csv').addEventListener('click',()=>{const params=new URLSearchParams({year:String(state.date.getFullYear())});if(state.mode==='month')params.set('month',String(state.date.getMonth()+1));if(selectedPost())params.set('post_id',selectedPost());window.location.href=`/api/exports/shifts.csv?${params}`});
$('#choose-csv').addEventListener('click',()=>$('#csv-file').click());
$('#csv-file').addEventListener('change',e=>{previewAndImport(e.target.files[0]);e.target.value=''});
$$('.csv-inline').forEach(input=>input.addEventListener('change',e=>{previewAndImport(e.target.files[0]);e.target.value=''}));
$('#drop-zone').addEventListener('dragover',e=>{e.preventDefault();e.currentTarget.classList.add('dragging')});$('#drop-zone').addEventListener('dragleave',e=>e.currentTarget.classList.remove('dragging'));$('#drop-zone').addEventListener('drop',e=>{e.preventDefault();e.currentTarget.classList.remove('dragging');previewAndImport(e.dataTransfer.files[0])});
$('#drop-zone').addEventListener('click',e=>{if(e.target.closest('button'))return;$('#csv-file').click()});
$('#break-start').addEventListener('input',()=>$('#break-paid-label').classList.toggle('hidden',!$('#break-start').value));$('#break-end').addEventListener('input',()=>$('#break-paid-label').classList.toggle('hidden',!$('#break-end').value));
$('#review-list').addEventListener('click',async e=>{
  const confirm=e.target.closest('[data-confirm-shift]');const discardShift=e.target.closest('[data-discard-shift]');const resolve=e.target.closest('[data-resolve-review]');const discard=e.target.closest('[data-discard-review]');
  try{
    if(confirm){await api(`/api/shifts/${confirm.dataset.confirmShift}/confirm`,{method:'POST'});toast('Turno confirmado y contabilizado.')}
    if(discardShift){await api(`/api/shifts/${discardShift.dataset.discardShift}`,{method:'DELETE'});toast('Turno pendiente descartado.')}
    if(discard){await api(`/api/review/${discard.dataset.discardReview}`,{method:'DELETE'});toast('Fila descartada.')}
    if(resolve){const card=resolve.closest('[data-review-card]');const value=(name)=>card.querySelector(`[data-field="${name}"]`)?.value||'';const breakStart=value('break_start_at');const data={employee_id:value('employee_id'),post_id:value('post_id'),start_at:value('start_at'),end_at:value('end_at'),break_start_at:breakStart||null,break_end_at:value('break_end_at')||null,break_paid:breakStart?value('break_paid')==='true':false};await api(`/api/review/${resolve.dataset.resolveReview}/resolve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});toast('Fila corregida y confirmada.')}
    await reloadBase();await reloadReport();
  }catch(err){toast(err.message)}
});
$('#duplicates-list').addEventListener('click',async e=>{const button=e.target.closest('[data-merge-source]');if(!button)return;if(!window.confirm('¿Unificar los turnos y resúmenes del empleado repetido en el principal? El ID duplicado se eliminará.'))return;try{const result=await api(`/api/employees/${button.dataset.mergeKeep}/merge`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_id:button.dataset.mergeSource})});await loadAll();await reloadReview();toast(`Empleado unificado: ${result.merged_shifts} turno(s) movidos.`)}catch(error){toast(error.message)}});
$('#holiday-list').addEventListener('click',async e=>{const button=e.target.closest('[data-delete-holiday]');if(!button)return;try{await api(`/api/holidays/${button.dataset.deleteHoliday}`,{method:'DELETE'});await reloadBase();await reloadReport();toast('Festivo eliminado.')}catch(error){toast(error.message)}});
$('#summaries-body').addEventListener('click',async e=>{const button=e.target.closest('[data-delete-summary]');if(!button)return;try{await api(`/api/monthly-summaries/${button.dataset.deleteSummary}`,{method:'DELETE'});await reloadReport();toast('Resumen mensual eliminado.')}catch(error){toast(error.message)}});
$('#add-holiday').addEventListener('click',()=>{const municipality=$('#holiday-municipality');municipality.innerHTML='<option value="">Selecciona municipio</option>'+[...new Set(state.posts.map(p=>p.municipality))].sort().map(m=>`<option>${esc(m)}</option>`).join('');$('#holiday-form').reset();$('#holiday-error').classList.add('hidden');openDialog('#holiday-dialog')});
$('#holiday-form').addEventListener('submit',async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget));try{await api('/api/holidays',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});closeDialogs();await reloadBase();await reloadReport();toast('Festivo guardado para ese municipio.')}catch(error){showError($('#holiday-error'),error.message)}});  $('#shifts-body').addEventListener('click',e=>{const button=e.target.closest('[data-edit-shift]');if(!button)return;const shift=state.report.shifts.find(item=>item.id===button.dataset.editShift);if(shift)openShift({id:shift.id,employee:shift.employee_id,post:shift.post_id,start:shift.start_at.slice(0,16),end:shift.end_at.slice(0,16),break_start_at:shift.break_start_at,break_end_at:shift.break_end_at,break_paid:Boolean(shift.break_paid)})});
$('#help-button').addEventListener('click',()=>toast('Aplicación local. Festivos: añádelos por municipio en el calendario. Turnos importados: confirma antes de calcular informes.'));
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#employee-search').focus()}if(e.key==='Escape')$('#sidebar').classList.remove('open')});
window.addEventListener('hashchange',()=>navigate(location.hash.replace('#','')==='inicio'?'overview':location.hash.slice(1)));
(async()=>{try{await loadAll();const requested=location.hash.replace('#','');navigate(requested==='inicio'?'overview':(requested||'overview'));}catch(error){toast(`No se pudo iniciar: ${error.message}`)}})();
