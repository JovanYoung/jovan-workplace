# -*- coding: utf-8 -*-
# One-shot patch for renderer/index.html: migrate data layer to Electron contextBridge.
import io

P = r"D:/Jovan's Workplace/app/renderer/index.html"
c = io.open(P, encoding='utf-8').read()

R = []

# 1. variable declaration: drop smart-page SDK, add hasWP
R.append((r"""  var db = (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) || null;
  var DATABASE_ID = 'Iozqi3v50wtkPwkfSDOSOD';
  var ALL_ROWS = [];
  var SCHEMA_OPTIONS = {};
  var studyFilter = 'all';
  var taskFilter = 'all';
  var currentTab = 'today';
  var hasSdk = !!(db && db.query);""",
r"""  var ALL_ROWS = [];
  var SCHEMA_OPTIONS = {};
  var studyFilter = 'all';
  var taskFilter = 'all';
  var currentTab = 'today';
  var hasWP = !!(window.workplace && window.workplace.loadData);"""))

# 2. bind() -> no-op
R.append((r"""  function bind(el){ if(el){ el.setAttribute('data-sp-bindable','database'); el.setAttribute('data-sp-database-id',DATABASE_ID); } }""",
r"""  function bind(el){ /* no-op: smart-page SDK removed */ }"""))

# 3. setSync
R.append((r"""  function setSync(state,text){
    var dot=$('setSyncDot'), tx=$('setSyncText');
    var cls='off', msg='本地未连接 · 当前读写云端副本';
    if(bridgeOk){ cls='ok'; msg='本地数据 · 已连接（实时写入 D:\\dsh-data）'; }
    else if(!hasSdk){ cls='off'; msg='离线模式 · 数据仅存浏览器'; }
    if(dot){ dot.className='dot '+cls; dot.title=text||msg; }
    if(tx) tx.textContent=msg;
  }""",
r"""  function setSync(state,text){
    var dot=$('setSyncDot'), tx=$('setSyncText');
    var cls='off', msg='本地数据 · 已连接（Electron 直写）';
    if(hasWP){ cls='ok'; msg='本地数据 · 已连接（Electron 直写 workspace.json）'; }
    else { cls='off'; msg='离线模式 · 数据仅存浏览器'; }
    if(dot){ dot.className='dot '+cls; dot.title=text||msg; }
    if(tx) tx.textContent=msg;
  }"""))

# 4. syncInfo
R.append((r"""  function syncInfo(){
    var msg=bridgeOk?'本地数据 · 已连接（数据实时写入 D:\\dsh-data，走本地桥）':(hasSdk?'本地未连接 · 当前读写云端副本':'离线模式 · 数据仅存浏览器');
    toast(msg);
  }""",
r"""  function syncInfo(){
    var msg=hasWP?'本地数据 · 已连接（Electron 直写 workspace.json）':'离线模式 · 数据仅存浏览器';
    toast(msg);
  }"""))

# 5. loadOptions -> renderEmptyOptions only
R.append((r"""  function loadOptions(){
    if(!hasSdk){ setSync('off','离线模式 · 本地预览'); renderEmptyOptions(); return; }
    setSync('busy','同步中…');
    db.getSchema({databaseId:DATABASE_ID}).then(function(schema){
      SCHEMA_OPTIONS={};
      (schema.properties||[]).forEach(function(f){
        if((f.type==='select'||f.type==='multi_select')&&f.config&&f.config.options){
          SCHEMA_OPTIONS[f.name]=f.config.options;
        }
      });
      renderSelectOptions();
      loadData();
      setSync('ok','已同步 · 云端存储');
    }).catch(function(err){
      setSync('off','同步失败 · 本地缓存');
      loadData();
    });
  }""",
r"""  function loadOptions(){
    renderEmptyOptions();
  }"""))

# 6. wList
R.append((r"""  function wList(){
    if(bridgeOk) return fetch(BRIDGE+'/data',{mode:'cors'}).then(function(r){ return r.json(); }).then(function(j){
      birthdayMap={};
      (j.birthdays||[]).forEach(function(b){ birthdayMap[b.id]={name:b.name,dates:b.dates||[]}; });
      return j.rows||[];
    });
    if(hasSdk) return db.query({databaseId:DATABASE_ID,pageSize:200}).then(function(r){ return r.results||[]; });
    return Promise.resolve(localLoad());
  }""",
r"""  function wList(){
    if(hasWP) return window.workplace.loadData().then(function(j){
      birthdayMap={};
      (j.birthdays||[]).forEach(function(b){ birthdayMap[b.id]={name:b.name,dates:b.dates||[]}; });
      return j.rows||[];
    });
    return Promise.resolve(localLoad());
  }"""))

# 7. wMutate
R.append((r"""  function wMutate(action,payload){
    if(bridgeOk) return fetch(BRIDGE+'/data',{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action,props:payload.props||null,id:payload.id||null})}).then(function(r){ return r.json(); }).catch(function(){ bridgeOk=false; return null; });
    return Promise.resolve(null);
  }""",
r"""  function wMutate(action,payload){
    if(hasWP) return window.workplace.mutate(action,payload).then(function(r){ return (r&&r.ok)?r:null; }).catch(function(){ return null; });
    return Promise.resolve(null);
  }"""))

# 8. wAdd / wUpdate / wDel
R.append((r"""  function wAdd(props){
    if(bridgeOk) return wMutate('add',{props:props}).then(function(){ return loadData(); });
    if(hasSdk) return db.addRecord({databaseId:DATABASE_ID,properties:props}).then(function(){ return loadData(); });
    localAdd(props); return Promise.resolve();
  }
  function wUpdate(id,props){
    if(bridgeOk) return wMutate('update',{id:id,props:props}).then(function(){ return loadData(); });
    if(hasSdk) return db.updateRecord({databaseId:DATABASE_ID,recordId:id,properties:props}).then(function(){ return loadData(); });
    localUpdate(id,props); renderAll(); return Promise.resolve();
  }
  function wDel(id){
    if(bridgeOk) return wMutate('delete',{id:id}).then(function(){ return loadData(); });
    if(hasSdk) return db.deleteRecord({databaseId:DATABASE_ID,recordId:id}).then(function(){ return loadData(); });
    ALL_ROWS=ALL_ROWS.filter(function(r){ return r._id!==id; });
    localSave(ALL_ROWS); renderAll(); return Promise.resolve();
  }""",
r"""  function wAdd(props){
    if(hasWP) return wMutate('add',{props:props}).then(function(){ return loadData(); });
    localAdd(props); return Promise.resolve();
  }
  function wUpdate(id,props){
    if(hasWP) return wMutate('update',{id:id,props:props}).then(function(){ return loadData(); });
    localUpdate(id,props); renderAll(); return Promise.resolve();
  }
  function wDel(id){
    if(hasWP) return wMutate('delete',{id:id}).then(function(){ return loadData(); });
    ALL_ROWS=ALL_ROWS.filter(function(r){ return r._id!==id; });
    localSave(ALL_ROWS); renderAll(); return Promise.resolve();
  }"""))

# 9. probeBridge -> only probe AI bridge (no data load)
R.append((r"""  function probeBridge(){
    if(location.protocol==='https:'){ bridgeOk=false; return; }
    fetch(BRIDGE+'/ping',{mode:'cors'}).then(function(){
      bridgeOk=true;
      setSync('ok','本地数据 · 已连接');
      loadData();
    }).catch(function(){
      bridgeOk=false;
      setSync('ok','云端同步');
      loadData();
    });
  }""",
r"""  function probeBridge(){
    if(location.protocol==='https:'){ bridgeOk=false; return; }
    fetch(BRIDGE+'/ping',{mode:'cors'}).then(function(){
      bridgeOk=true;
    }).catch(function(){
      bridgeOk=false;
    });
  }"""))

# 10. fetchBdays -> prefer workplace, fallback bridge; add convCall helper
R.append((r"""  function fetchBdays(year){
    return fetch(BRIDGE+'/bday?year='+year,{mode:'cors'}).then(function(r){ return r.json(); }).then(function(j){
      var m={};
      (j.birthdays||[]).forEach(function(b){ m[b.id]={name:b.name,dates:b.dates||[]}; });
      bdayByYear[year]=m;
      return m;
    }).catch(function(){ return null; });
  }""",
r"""  function fetchBdays(year){
    if(hasWP) return window.workplace.birthdays(year).then(function(j){
      var m={};
      (j.birthdays||[]).forEach(function(b){ m[b.id]={name:b.name,dates:b.dates||[]}; });
      bdayByYear[year]=m;
      return m;
    }).catch(function(){ return null; });
    return fetch(BRIDGE+'/bday?year='+year,{mode:'cors'}).then(function(r){ return r.json(); }).then(function(j){
      var m={};
      (j.birthdays||[]).forEach(function(b){ m[b.id]={name:b.name,dates:b.dates||[]}; });
      bdayByYear[year]=m;
      return m;
    }).catch(function(){ return null; });
  }
  function convCall(mode,params){
    if(hasWP) return window.workplace.conv(mode,params).catch(function(){ return {ok:false}; });
    var qs='mode='+mode;
    Object.keys(params||{}).forEach(function(k){ qs+='&'+k+'='+encodeURIComponent(params[k]); });
    return fetch(BRIDGE+'/conv?'+qs,{mode:'cors'}).then(function(r){ return r.json(); }).catch(function(){ return {ok:false}; });
  }"""))

# 11. conv calls (4 sites)
R.append((r"""        fetch(BRIDGE+'/conv?mode=lunar2solar&year='+by+'&lm='+lm2+'&ld='+ld2,{mode:'cors'}).then(function(r){return r.json();}).then(function(j){""",
r"""        convCall('lunar2solar',{year:by,lm:lm2,ld:ld2}).then(function(j){"""))
R.append((r"""      fetch(BRIDGE+'/conv?mode=solar2lunar&date='+bd,{mode:'cors'}).then(function(r){return r.json();}).then(function(j){""",
r"""      convCall('solar2lunar',{date:bd}).then(function(j){"""))
R.append((r"""              fetch(BRIDGE+'/conv?mode=lunar2solar&year='+by+'&lm='+lm2+'&ld='+ld2,{mode:'cors'}).then(function(r){return r.json();}).then(function(j){""",
r"""              convCall('lunar2solar',{year:by,lm:lm2,ld:ld2}).then(function(j){"""))
R.append((r"""            fetch(BRIDGE+'/conv?mode=solar2lunar&date='+bd,{mode:'cors'}).then(function(r){return r.json();}).then(function(j){""",
r"""            convCall('solar2lunar',{date:bd}).then(function(j){"""))

# 12. fetchBdays call site in renderCal
R.append((r"""      if(bridgeOk) fetchBdays(year).then(function(){ renderCal(); });""",
r"""      if(hasWP||bridgeOk) fetchBdays(year).then(function(){ renderCal(); });"""))

# 13. seedLocal condition in loadData
R.append((r"""      if(!ALL_ROWS.length&&!hasSdk&&!bridgeOk) seedLocal();""",
r"""      if(!ALL_ROWS.length&&!hasWP) seedLocal();"""))

# 14. markDone fallback
R.append((r"""    if(!hasSdk&&!bridgeOk){""",
r"""    if(!hasWP){"""))

# 15. tab switch auto-refresh
R.append((r"""    if(tab!=='agent'&&hasSdk&&Date.now()-lastRefresh>8000){ lastRefresh=Date.now(); loadData(); }""",
r"""    if(tab!=='agent'&&hasWP&&Date.now()-lastRefresh>8000){ lastRefresh=Date.now(); loadData(); }"""))

# 16. init
R.append((r"""  if(!hasSdk) setSync('off','离线模式 · 本地预览');
  loadOptions();
  probeBridge();
  checkAgent();""",
r"""  if(!hasWP) setSync('off','离线模式 · 本地预览');
  loadOptions();
  probeBridge();
  checkAgent();"""))

# 17. exportBackup -> dialog
R.append((r"""  function exportBackup(){
    if(!ALL_ROWS.length){ toast('暂无数据可导出'); return; }
    var payload={exportedAt:new Date().toISOString(),count:ALL_ROWS.length,records:ALL_ROWS};
    var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='申研工作台备份-'+todayStr()+'.json';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(a.href); },200);
    appendLog('导出','备份','全部数据');
    toast('已导出 '+ALL_ROWS.length+' 条数据');
  }""",
r"""  function exportBackup(){
    if(!ALL_ROWS.length){ toast('暂无数据可导出'); return; }
    var payload={exportedAt:new Date().toISOString(),count:ALL_ROWS.length,records:ALL_ROWS};
    var name='Jovan工作台备份-'+todayStr()+'.json';
    if(hasWP){
      window.workplace.exportData(JSON.stringify(payload,null,2),name).then(function(r){
        if(r&&r.ok){ appendLog('导出','备份','全部数据'); toast('已导出 '+ALL_ROWS.length+' 条数据'); }
        else if(!(r&&r.canceled)) toast('导出失败：'+((r&&r.error)||'未知'));
      });
      return;
    }
    var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=name;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(a.href); },200);
    appendLog('导出','备份','全部数据');
    toast('已导出 '+ALL_ROWS.length+' 条数据');
  }"""))

# 18. importBackup -> doImport via workplace
R.append((r"""  function importBackup(file){
    var reader=new FileReader();
    reader.onload=function(){
      try{
        var data=JSON.parse(reader.result);
        var list=data.records||(data instanceof Array?data:[]);
        if(!list.length){ toast('文件里没有记录'); return; }
        appendLog('导入','备份',file.name);
        var ok=0,fail=0;
        list.forEach(function(r){
          var properties={};
          properties['标题']={text:(r['标题']||'未命名')};
          properties['类型']={select:(r['类型']||'备忘')};
          if(r['优先级']) properties['优先级']={select:r['优先级']};
          if(r['状态']) properties['状态']={select:r['状态']};
          if(r['标签']) properties['标签']={text:r['标签']};
          if(r['日期']) properties['日期']={date:String(r['日期']).slice(0,10)};
          if(r['详情']) properties['详情']={text:r['详情']};
          db.addRecord({databaseId:DATABASE_ID,properties:properties}).then(function(){ ok++; if(ok+fail===list.length) afterImport(ok,fail); }).catch(function(){ fail++; if(ok+fail===list.length) afterImport(ok,fail); });
        });
      }catch(e){ toast('备份文件格式不正确'); }
    };
    reader.readAsText(file);
    function afterImport(okN,failN){ loadData(); toast('导入完成：成功 '+okN+' 条'+(failN?'，失败 '+failN+' 条':'')); }
  }""",
r"""  function importBackup(file){
    var reader=new FileReader();
    reader.onload=function(){ doImport(reader.result, file.name); };
    reader.readAsText(file);
  }
  function doImport(text,name){
    try{
      var data=JSON.parse(text);
      var list=data.records||(data instanceof Array?data:[]);
      if(!list.length){ toast('文件里没有记录'); return; }
      appendLog('导入','备份',name);
      var ok=0,fail=0, total=list.length;
      function afterImport(){ loadData(); toast('导入完成：成功 '+ok+' 条'+(fail?'，失败 '+fail+' 条':'')); }
      list.forEach(function(r){
        var props={};
        props['标题']={text:(r['标题']||'未命名')};
        props['类型']={select:(r['类型']||'备忘')};
        if(r['优先级']) props['优先级']={select:r['优先级']};
        if(r['状态']) props['状态']={select:r['状态']};
        if(r['标签']) props['标签']={text:r['标签']};
        if(r['日期']) props['日期']={date:String(r['日期']).slice(0,10)};
        if(r['详情']) props['详情']={text:r['详情']};
        wAdd(props).then(function(){ ok++; if(ok+fail===total) afterImport(); }).catch(function(){ fail++; if(ok+fail===total) afterImport(); });
      });
    }catch(e){ toast('备份文件格式不正确'); }
  }
  function wpImport(){
    window.workplace.importData().then(function(r){
      if(!r||r.canceled) return;
      if(r.error){ toast('导入失败：'+r.error); return; }
      doImport(r.content, (String(r.path||'').split(/[\\/]/).pop())||'backup.json');
    });
  }"""))

# 19. setBackupNow -> ima via workplace
R.append((r"""    if(e.target.id==='setBackupNow'){
      if(!bridgeOk){ toast('本地桥未连接，无法备份'); return; }
      e.target.disabled=true; e.target.textContent='备份中…';
      fetch(BRIDGE+'/backup',{mode:'cors'}).then(function(r){ return r.json(); }).then(function(j){
        e.target.disabled=false; e.target.textContent='立即备份到 ima';
        if(j&&j.ok){
          localStorage.setItem('wb_last_autobackup',todayStr());
          var bt=$('setBackupTime'); if(bt) bt.textContent=todayStr();
          toast('已备份到 ima');
        }else toast('备份失败：'+(j&&j.error||'未知'));
      }).catch(function(){ e.target.disabled=false; e.target.textContent='立即备份到 ima'; toast('连不上本地桥'); });
      return;
    }""",
r"""    if(e.target.id==='setBackupNow'){
      if(!hasWP){ toast('本地桥未连接，无法备份'); return; }
      e.target.disabled=true; e.target.textContent='备份中…';
      window.workplace.imaBackup().then(function(j){
        e.target.disabled=false; e.target.textContent='立即备份到 ima';
        if(j&&j.ok){
          localStorage.setItem('wb_last_autobackup',todayStr());
          var bt=$('setBackupTime'); if(bt) bt.textContent=todayStr();
          toast('已备份到 ima');
        }else toast('备份失败：'+((j&&j.error)||'未知'));
      }).catch(function(){ e.target.disabled=false; e.target.textContent='立即备份到 ima'; toast('备份失败'); });
      return;
    }"""))

# 20. autoBackup -> ima via workplace
R.append((r"""  function autoBackup(){
    if(!bridgeOk) return;
    if(localStorage.getItem('wb_autobackup')==='0') return;
    try{
      var last=localStorage.getItem('wb_last_autobackup')||'';
      var today=todayStr();
      if(last===today) return;
      fetch(BRIDGE+'/backup',{mode:'cors'}).then(function(r){ return r.json(); }).then(function(j){
        if(j&&j.ok){
          localStorage.setItem('wb_last_autobackup',today);
          appendLog('自动备份','ima','每日备份');
        }
      }).catch(function(){});
    }catch(e){}
  }""",
r"""  function autoBackup(){
    if(!hasWP) return;
    if(localStorage.getItem('wb_autobackup')==='0') return;
    try{
      var last=localStorage.getItem('wb_last_autobackup')||'';
      var today=todayStr();
      if(last===today) return;
      window.workplace.imaBackup().then(function(j){
        if(j&&j.ok){
          localStorage.setItem('wb_last_autobackup',today);
          appendLog('自动备份','ima','每日备份');
        }
      }).catch(function(){});
    }catch(e){}
  }"""))

# 21. data file path -> dynamic
R.append((r"""          <div class="set-row"><span class="set-label">数据文件</span><span class="set-val">D:\dsh-data\workspace.json（本地）</span></div>""",
r"""          <div class="set-row"><span class="set-label">数据文件</span><span class="set-val" id="setDataPath">—</span></div>"""))

# 22. settings panel: add ima key button
R.append((r"""          <div class="set-actions">
            <button class="btn btn-sm btn-primary" id="setBackupNow">立即备份到 ima</button>
            <button class="btn btn-sm btn-ghost" data-act="set-export">导出 JSON</button>
            <button class="btn btn-sm btn-ghost" data-act="set-import">导入恢复</button>
          </div>""",
r"""          <div class="set-actions">
            <button class="btn btn-sm btn-primary" id="setBackupNow">立即备份到 ima</button>
            <button class="btn btn-sm btn-ghost" id="setImaKey">重新填写 ima Key</button>
            <button class="btn btn-sm btn-ghost" data-act="set-export">导出 JSON</button>
            <button class="btn btn-sm btn-ghost" data-act="set-import">导入恢复</button>
          </div>"""))

# 23. openSettings: fill dynamic data path
R.append((r"""  function openSettings(){""",
r"""  function openSettings(){
    if(hasWP){ window.workplace.getDataPath().then(function(p){ var el=$('setDataPath'); if(el&&p) el.textContent=p.dataFile; }); }"""))

# 24. click handler: ima key input
R.append((r"""    if(e.target.id==='setDictClear'){""",
r"""    if(e.target.id==='setImaKey'){
      if(!hasWP){ toast('仅桌面版支持'); return; }
      var k=prompt('请输入 ima API Key（仅存本机加密，不会上传）','');
      if(k!==null&&k.trim()){
        window.workplace.imaSetKey(k.trim()).then(function(r){
          toast(r&&r.ok?'ima Key 已保存':'保存失败：'+((r&&r.error)||'未知'));
        });
      }
      return;
    }
    if(e.target.id==='setDictClear'){"""))

# 25. import triggers -> dialog
R.append((r"""        if(act==='set-import'){ $('importFile').click(); return; }""",
r"""        if(act==='set-import'){ if(hasWP){ wpImport(); return; } $('importFile').click(); return; }"""))
R.append((r"""        if(bid==='btnImportTop'){ $('importFile').click(); return; }""",
r"""        if(bid==='btnImportTop'){ if(hasWP){ wpImport(); return; } $('importFile').click(); return; }"""))

# 26. version + copy texts
R.append((r"""Jovan's Workplace · v37 · 数据本地存储 + ima 自动备份""",
r"""Jovan's Workplace · v0.0.0 · 本地数据 + ima 自动备份"""))
R.append((r"""<span class="hint">数据实时同步云端</span>""",
r"""<span class="hint">数据实时本地保存</span>"""))

fail = []
for i, (o, n) in enumerate(R, 1):
    cnt = c.count(o)
    if cnt == 0:
        fail.append(i)
        print("[MISS] #%d: %r" % (i, o[:70]))
        continue
    c = c.replace(o, n)
    print("[OK]   #%d: %dx" % (i, cnt))

io.open(P, 'w', encoding='utf-8').write(c)
print("---- done. missing:", fail if fail else "none")
