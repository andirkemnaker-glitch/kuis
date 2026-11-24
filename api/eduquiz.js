/**
 * EduQuiz UNIPI backend V2 - draft for integration testing.
 * Keep existing Pakets and Results sheets unchanged as a backup.
 * Pair with the updated V2 index.html and Vercel /api/eduquiz.
 * Student quiz scores are returned only for the just-submitted receipt.
 */
const SPREADSHEET_ID = '1DhJKGE0wAd_hPYvtgEDZ_nyrlZx-_XJi3nh6wXa9kf8';
const SHEET_QUIZ = 'QuizPackagesV2';
const SHEET_EXAM = 'ExamPackagesV2';
const SHEET_QUIZ_RESULTS = 'QuizResultsV2';
const SHEET_EXAM_RESULTS = 'ExamResultsV2';
const PROP_ADMIN_TOKEN = 'EDUQUIZ_ADMIN_TOKEN';

function db_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function sheet_(name) {
  const ss = db_();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function records_(name) {
  const sh = sheet_(name), n=sh.getLastRow();
  if (!n) return [];
  return sh.getRange(1,1,n,1).getValues().flat().filter(Boolean).map(v=>{
    try { return JSON.parse(String(v)); } catch (_) { return null; }
  }).filter(Boolean);
}
function put_(name, obj) {
  if(!obj || !obj.id) throw Error('ID data wajib diisi');
  const sh=sheet_(name), rows=records_(name), ix=rows.findIndex(r=>r.id===obj.id);
  const str=JSON.stringify(obj);
  if(str.length>49000) throw Error('Data terlalu besar untuk satu sel. Pisahkan paket menjadi lebih kecil.');
  if(ix>=0) sh.getRange(ix+1,1).setValue(str); else sh.appendRow([str]);
}
function json_(obj, callback) {
  const body=JSON.stringify(obj);
  if(callback) {
    if(!/^[A-Za-z_$][A-Za-z0-9_$\.]{0,80}$/.test(callback)) throw Error('Invalid callback');
    return ContentService.createTextOutput(callback+'('+body+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}
/** NPM is a per-package submission identifier (not proof of identity). */
function normalizedNpm_(value) {
  return String(value == null ? '' : value).normalize('NFKC').trim().toUpperCase().replace(/[\s-]+/g, '');
}
function validNpm_(value) {
  return /^[A-Z0-9]{5,30}$/.test(normalizedNpm_(value));
}
function alreadySubmitted_(table, field, packageId, npm) {
  const normalized=normalizedNpm_(npm);
  return records_(table).some(r=>r[field]===packageId && normalizedNpm_(r.npm)===normalized);
}

function isAdmin_(payload) {
  const saved=PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_TOKEN);
  return Boolean(saved && payload && payload.adminToken && String(payload.adminToken)===saved);
}
function publicQuiz_(p) {
  return {id:p.id, title:p.title, matkul:p.matkul, active:true,
    questions:(p.questions||[]).map(q=>({type:q.type, q:q.q, options:q.type==='pg'?q.options:undefined}))};
}
function publicExam_(p) {
  return {id:p.id,title:p.title,course:p.course,type:p.type,duration:p.duration,active:true,published:true,
    questions:(p.questions||[]).map(q=>({a:q.a,b:q.useB===false?'':q.b,
      useB:q.useB!==false,weightA:q.weightA,weightB:q.useB===false?0:q.weightB}))};
}

/** Run once manually; the generated token appears only in your own Execution log.
 * Copy it to a private location. Never include it in public HTML/GitHub.
 */
function setupDatabaseV2() {
  [SHEET_QUIZ,SHEET_EXAM,SHEET_QUIZ_RESULTS,SHEET_EXAM_RESULTS].forEach(sheet_);
  const props=PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_ADMIN_TOKEN)) {
    const token=Utilities.getUuid()+'-'+Utilities.getUuid();
    props.setProperty(PROP_ADMIN_TOKEN,token);
    Logger.log('ADMIN TOKEN (RAHASIA; JANGAN MASUKKAN KE GITHUB): '+token);
  } else Logger.log('Admin token sudah ada (tidak dibuat ulang).');
  Logger.log('Backend V2 siap. Data Pakets/Results lama tidak dihapus.');
}

/** Public API exposes only active questions, never keys, rubrics or results. */
function doGet(e) {
  try {
    const p=(e&&e.parameter)||{};
    if(p.action && p.action!=='public_packages') throw Error('Aksi GET tidak tersedia');
    const pakets=records_(SHEET_QUIZ).filter(x=>x.active===true).map(publicQuiz_);
    const exams=records_(SHEET_EXAM).filter(x=>x.active===true && x.published===true).map(publicExam_);
    return json_({status:'success',pakets,exams,generatedAt:new Date().toISOString()},p.callback);
  } catch(err) {
    return json_({status:'error',message:err.message},e&&e.parameter&&e.parameter.callback);
  }
}

/** Private admin writes require a secret entered by the lecturer, not bundled in frontend. */
function doPost(e) {
  const lock=LockService.getScriptLock();
  try {
    const payload=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    lock.waitLock(30000);
    switch(payload.action) {
      case 'admin_snapshot': {
        if(!isAdmin_(payload)) throw Error('Akses dosen ditolak');
        return json_({status:'success',pakets:records_(SHEET_QUIZ),exams:records_(SHEET_EXAM),results:records_(SHEET_QUIZ_RESULTS),examResults:records_(SHEET_EXAM_RESULTS)});
      }
      case 'delete_quiz_package':
      case 'delete_exam_package':
      case 'delete_quiz_result':
      case 'delete_exam_result': {
        if(!isAdmin_(payload)) throw Error('Akses dosen ditolak');
        const table={delete_quiz_package:SHEET_QUIZ,delete_exam_package:SHEET_EXAM,delete_quiz_result:SHEET_QUIZ_RESULTS,delete_exam_result:SHEET_EXAM_RESULTS}[payload.action];
        const sh=sheet_(table), all=records_(table), idx=all.findIndex(x=>x.id===payload.id);
        if(idx<0)throw Error('Data tidak ditemukan');
        if(payload.action==='delete_quiz_package' && records_(SHEET_QUIZ_RESULTS).some(x=>x.paketId===payload.id))throw Error('Paket memiliki nilai; tidak dapat dihapus');
        if(payload.action==='delete_exam_package' && records_(SHEET_EXAM_RESULTS).some(x=>x.packageId===payload.id))throw Error('Paket memiliki jawaban; tidak dapat dihapus');
        sh.deleteRow(idx+1);return json_({status:'success'});
      }
      case 'save_quiz_package': {
        if(!isAdmin_(payload)) throw Error('Akses dosen ditolak');
        const p=payload.data;
        if(!p || !p.id || !p.title || !p.matkul || !Array.isArray(p.questions)) throw Error('Paket kuis tidak valid');
        if(records_(SHEET_QUIZ_RESULTS).some(r=>r.paketId===p.id)) {
          const old=records_(SHEET_QUIZ).find(x=>x.id===p.id);
          if(old && JSON.stringify(old.questions)!==JSON.stringify(p.questions)) throw Error('Paket sudah memiliki hasil, buat paket baru untuk mengganti soal');
        }
        put_(SHEET_QUIZ,{...p,active:p.active===true,updatedAt:new Date().toISOString()});
        return json_({status:'success',id:p.id});
      }
      case 'save_exam_package': {
        if(!isAdmin_(payload)) throw Error('Akses dosen ditolak');
        const p=payload.data;
        if(!p || !p.id || !p.title || !p.course || !['UTS','UAS','Tugas'].includes(p.type) || !Array.isArray(p.questions)) throw Error('Paket ujian tidak valid');
        if(records_(SHEET_EXAM_RESULTS).some(r=>r.packageId===p.id)) {
          const old=records_(SHEET_EXAM).find(x=>x.id===p.id);
          if(old && JSON.stringify(old.questions)!==JSON.stringify(p.questions)) throw Error('Paket sudah memiliki jawaban, buat paket baru untuk mengganti soal');
        }
        put_(SHEET_EXAM,{...p,active:p.active===true,published:p.published===true,updatedAt:new Date().toISOString()});
        return json_({status:'success',id:p.id});
      }
      case 'check_attempt': {
        const d=payload.data||{};
        if(!validNpm_(d.npm)) throw Error('NPM harus 5–30 karakter angka atau huruf.');
        if(d.kind==='quiz') {
          if(!records_(SHEET_QUIZ).some(p=>p.id===d.paketId && p.active===true)) throw Error('Paket kuis tidak aktif');
          return json_({status:'success',alreadySubmitted:alreadySubmitted_(SHEET_QUIZ_RESULTS,'paketId',d.paketId,d.npm)});
        }
        if(d.kind==='exam') {
          if(!records_(SHEET_EXAM).some(p=>p.id===d.paketId && p.active===true && p.published===true)) throw Error('Paket ujian tidak aktif');
          return json_({status:'success',alreadySubmitted:alreadySubmitted_(SHEET_EXAM_RESULTS,'packageId',d.paketId,d.npm)});
        }
        throw Error('Jenis pemeriksaan tidak dikenal');
      }
      case 'submit_quiz': {
        const d=payload.data||{}, p=records_(SHEET_QUIZ).find(x=>x.id===d.paketId && x.active===true);
        if(!p) throw Error('Paket kuis tidak aktif');
        if(!validNpm_(d.npm) || !d.nama || !Array.isArray(d.answers) || d.answers.length!==p.questions.length) throw Error('NPM tidak valid atau jawaban kuis tidak lengkap');
        if(alreadySubmitted_(SHEET_QUIZ_RESULTS,'paketId',p.id,d.npm)) throw Error('NPM ini sudah pernah mengumpulkan kuis untuk paket tersebut. Satu NPM hanya boleh submit sekali per paket.');
        let benarPg=0, benarEssay=0;
        p.questions.forEach((q,i)=>{
          const a=String(d.answers[i]||'').trim().toLowerCase();
          if(q.type==='pg') { if(a===String(q.ans||'').trim().toLowerCase()) benarPg++; }
          else if(a && String(q.ans||'').toLowerCase().split('|').map(x=>x.trim()).includes(a)) benarEssay++;
        });
        const totalBenar=benarPg+benarEssay, totalSoal=p.questions.length;
        const r={id:Utilities.getUuid(),paketId:p.id,paketTitle:p.title,matkul:p.matkul,nama:d.nama,npm:normalizedNpm_(d.npm),
          benarPg,benarEssay,totalBenar,totalSoal,skala100:Math.round(totalBenar/totalSoal*100),
          submittedAt:new Date().toISOString(),totalPoin:Math.round(totalBenar/totalSoal*10000)/100,durationSec:Math.max(0,Number(d.durationSec)||0),durationText:(Math.floor((Number(d.durationSec)||0)/60)+':'+String((Number(d.durationSec)||0)%60).padStart(2,'0'))};
        put_(SHEET_QUIZ_RESULTS,r);
        return json_({
          status: 'success',
          receipt: r.id,
          result: {
            benarPg: r.benarPg,
            benarEssay: r.benarEssay,
            totalBenar: r.totalBenar,
            totalSoal: r.totalSoal,
            totalPoin: r.totalPoin,
            skala100: r.skala100,
            durationSec: r.durationSec,
            durationText: r.durationText
          }
        });
      }
      case 'submit_exam': {
        const d=payload.data||{}, p=records_(SHEET_EXAM).find(x=>x.id===d.packageId && x.active===true && x.published===true);
        if(!p) throw Error('Paket ujian tidak aktif');
        if(!validNpm_(d.npm) || !d.name || !Array.isArray(d.answers) || d.answers.length!==p.questions.length) throw Error('NPM tidak valid atau jawaban ujian tidak lengkap');
        if(alreadySubmitted_(SHEET_EXAM_RESULTS,'packageId',p.id,d.npm)) throw Error('NPM ini sudah pernah mengumpulkan UTS/UAS/Tugas untuk paket tersebut.');
        const r={id:Utilities.getUuid(),packageId:p.id,packageTitle:p.title,course:p.course,type:p.type,
          npm:normalizedNpm_(d.npm),name:d.name,answers:d.answers,questionSnapshot:JSON.parse(JSON.stringify(p.questions)),
          scores:p.questions.map(()=>({a:0,b:0})),graded:false,submittedAt:new Date().toISOString()};
        put_(SHEET_EXAM_RESULTS,r);
        return json_({status:'success',receipt:r.id});
      }
      case 'approve_exam': {
        if(!isAdmin_(payload)) throw Error('Akses dosen ditolak');
        const d=payload.data||{}, old=records_(SHEET_EXAM_RESULTS).find(r=>r.id===d.id);
        if(!old) throw Error('Hasil ujian tidak ditemukan');
        if(!Array.isArray(d.scores) || d.scores.length!==old.questionSnapshot.length) throw Error('Jumlah nilai tidak sesuai');
        let total=0;
        d.scores.forEach((s,i)=>{
          const q=old.questionSnapshot[i];
          for(const k of ['a','b']) {
            const max=Number(q[k==='a'?'weightA':'weightB'])||0, val=Number(s[k]||0);
            if(!Number.isFinite(val)||val<0||val>max)throw Error('Nilai di luar bobot soal');
            if(k==='b' && (q.useB===false||old.type==='Tugas') && val!==0)throw Error('Bagian b tidak aktif');
            total+=val;
          }
        });
        const history=old.gradeHistory||[];
        history.push({at:new Date().toISOString(),oldScores:old.scores,newScores:d.scores,notes:d.notes||[],action:old.graded?'revisi dosen':'validasi dosen'});
        put_(SHEET_EXAM_RESULTS,{...old,scores:d.scores,notes:d.notes||[],graded:true,gradedAt:new Date().toISOString(),gradeHistory:history,total});
        return json_({status:'success',total});
      }
      default: throw Error('Aksi tidak dikenali');
    }
  } catch(err) {
    return json_({status:'error',message:err.message});
  } finally { if(lock.hasLock())lock.releaseLock(); }
}
