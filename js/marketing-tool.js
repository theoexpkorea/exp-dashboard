/* ============================================================
   theo 대시보드 — 마케팅툴 (js/marketing-tool.js)
   백엔드: 매물장필터뷰 Apps Script에 새로 추가된
   mode=marketingGetConfig / marketingSaveConfig / marketingGenerate 사용.
   Anthropic API 호출은 Apps Script(generateMarketingContent)가 대신 수행
   (API 키를 프론트에 노출하지 않기 위한 프록시 구조).

   사진 순서 제안 파싱: 응답 텍스트 끝에 백엔드가 아래 형식으로 붙여주는
   <<PHOTO_META>> 블록을 파싱해서, 제안된 순서대로 파일명을 다시 매겨
   zip으로 다운로드하는 기능 포함 (JSZip 사용, favIconChain 등은 favorites.js 재사용).
   ============================================================ */

const MKT_URL = (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) || '';
const MKT_MAX_PHOTOS = 8;
const MKT_MAX_DIM = 1440; // 리사이즈 후 최대 가로/세로
const MKT_JPEG_QUALITY = 0.82;

const MKT_QUICKLINKS = [
  { name: '부동산포스', url: 'https://www.rfine.kr/', icon: 'https://play-lh.googleusercontent.com/t2gKJy71YpOqvJMEkX_WxuUxHArMSVeUW6LdZP7Qev7M1hto4t8WZJUiE2V80uotat1b7PKP-7PcsoZxblRP=w128-h128' },
  { name: '네이버블로그', url: 'https://blog.naver.com/', icon: 'https://play-lh.googleusercontent.com/vh9R5EOEx7mk_YUM8gYgJF1GtlYrRwXu-QhIJ45rG5Y3_h640rYEFwH5d84yqGw7Xii1kzghygQZFTUY-uxS=w128-h128' },
  { name: '인스타그램', url: 'https://www.instagram.com/' },
  { name: '캔바', url: 'https://www.canva.com/' },
  { name: '캡컷', url: 'https://www.capcut.com/' },
];

const MKT_FORMAT_LABEL = { blog: '블로그', insta: '인스타', naver: '네이버광고' };

function $(id) { return document.getElementById(id); }
function mktToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

/* ===== state ===== */
let mktFormat = 'blog';           // 'blog' | 'insta' | 'naver'
let mktModel = 'sonnet';          // 'haiku' | 'sonnet'
let mktModelTouched = false;      // 사용자가 직접 모델을 바꿨는지 (포맷 전환 시 기본값 덮어쓰기 방지용)
let mktPhotos = [];               // [{ id, previewUrl, mediaType, base64 }]
let mktLastGenPhotos = [];        // 마지막 생성 시점의 사진 스냅샷 (다운로드용, 생성 이후 첨부 목록이 바뀌어도 안 깨지게)
let mktLastGenFormat = 'blog';
let mktLastPhotoMeta = null;      // { order:[...], captions:{n:text} }
let mktNaverTemplate = '';
let mktInstaTemplate = '';
let mktBusy = false;
let mktRefineBusy = false;
let mktConversation = [];         // Anthropic messages 형식 그대로 유지 (다듬기 요청 시 이어서 전송)
let mktRefineTurns = 0;
const MKT_MAX_REFINE_TURNS = 4;   // 최초 생성 이후 다듬기 가능 횟수

const MKT_DEFAULT_MODEL = { blog: 'sonnet', insta: 'haiku', naver: 'haiku' };

/* ===== 바로가기(부동산포스/블로그/인스타/캔바/캡컷) ===== */
function mktRenderQuicklinks() {
  const mount = $('mktQuicklinks');
  if (!mount) return;
  mount.innerHTML = MKT_QUICKLINKS.map((f) => {
    const chain = (typeof favIconChain === 'function') ? favIconChain(f) : null;
    const src = chain ? chain.src : '';
    const chainJson = chain ? JSON.stringify(chain.fallbacks) : '[]';
    return `
      <a class="mkt-quicklink" href="${f.url}" target="_blank" rel="noopener" title="${f.name}">
        <img src="${src}" data-fav-chain='${chainJson}' onerror="favIconFallback(this)" alt="" width="18" height="18" loading="lazy" />
        <span>${f.name}</span>
      </a>`;
  }).join('');
}

/* ===== 이미지 리사이즈 (canvas) ===== */
function mktResizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = () => reject(new Error('read_failed'));
    img.onload = () => {
      let { width, height } = img;
      if (width > MKT_MAX_DIM || height > MKT_MAX_DIM) {
        const ratio = Math.min(MKT_MAX_DIM / width, MKT_MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', MKT_JPEG_QUALITY);
      resolve({ previewUrl: dataUrl, mediaType: 'image/jpeg', base64: dataUrl.split(',')[1] });
    };
    img.onerror = () => reject(new Error('decode_failed'));
    reader.readAsDataURL(file);
  });
}

async function mktAddFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  const room = MKT_MAX_PHOTOS - mktPhotos.length;
  if (room <= 0) { mktToast('사진은 최대 ' + MKT_MAX_PHOTOS + '장까지 첨부할 수 있어요.'); return; }
  const toAdd = files.slice(0, room);
  for (const file of toAdd) {
    try {
      const resized = await mktResizeImage(file);
      mktPhotos.push({ id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7), ...resized });
    } catch (e) { /* 개별 파일 실패는 조용히 건너뜀 */ }
  }
  if (files.length > toAdd.length) mktToast('사진은 최대 ' + MKT_MAX_PHOTOS + '장까지 첨부할 수 있어요.');
  mktRenderPhotoGrid();
}

function mktRemovePhoto(id) {
  mktPhotos = mktPhotos.filter((p) => p.id !== id);
  mktRenderPhotoGrid();
}

function mktRenderPhotoGrid() {
  const grid = $('mktPhotoGrid');
  grid.innerHTML = mktPhotos.map((p) => `
    <div class="mkt-photo-thumb">
      <img src="${p.previewUrl}" alt="">
      <button type="button" class="mkt-photo-remove" data-id="${p.id}">✕</button>
    </div>
  `).join('');
  grid.querySelectorAll('.mkt-photo-remove').forEach((btn) => {
    btn.addEventListener('click', () => mktRemovePhoto(btn.dataset.id));
  });
}

/* ===== 포맷/모델 탭 ===== */
function mktSetFormat(format) {
  mktFormat = format;
  document.querySelectorAll('#formatTabs .rec-filter-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.format === format);
  });
  $('mktNaverField').style.display = (format === 'naver') ? '' : 'none';
  $('mktInstaField').style.display = (format === 'insta') ? '' : 'none';
  if (!mktModelTouched) mktSetModel(MKT_DEFAULT_MODEL[format], false);
  mktResetConversation();
}

function mktSetModel(model, touched) {
  mktModel = model;
  if (touched) mktModelTouched = true;
  document.querySelectorAll('#mktModelToggle .mkt-model-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.model === model);
  });
}

/* ===== 네이버광고/인스타 고정양식 로드/저장 ===== */
async function mktLoadConfig() {
  if (!MKT_URL || typeof fetchJsonp !== 'function') return;
  try {
    const res = await fetchJsonp(MKT_URL + '?mode=marketingGetConfig');
    mktNaverTemplate = (res && res.naverTemplate) || '';
    $('mktNaverTemplate').value = mktNaverTemplate;
    mktInstaTemplate = (res && res.instaTemplate) || '';
    $('mktInstaTemplate').value = mktInstaTemplate;
  } catch (e) { /* 조용히 무시 — 생성 시점에 다시 시도 가능 */ }
}

function mktSaveTemplate() {
  const val = $('mktNaverTemplate').value;
  fetch(MKT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ mode: 'marketingSaveConfig', naverTemplate: val })
  }).then((res) => res.json()).then((res) => {
    if (res && res.ok) { mktNaverTemplate = val; mktToast('네이버광고 양식을 저장했어요.'); }
    else { mktToast('저장 실패 — 다시 시도해주세요.'); }
  }).catch(() => mktToast('저장 실패 — 인터넷 연결을 확인해주세요.'));
}

function mktSaveInstaTemplate() {
  const val = $('mktInstaTemplate').value;
  fetch(MKT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ mode: 'marketingSaveConfig', instaTemplate: val })
  }).then((res) => res.json()).then((res) => {
    if (res && res.ok) { mktInstaTemplate = val; mktToast(val ? '인스타 양식을 저장했어요.' : '인스타 양식을 비웠어요 — 이제 자유형으로 생성돼요.'); }
    else { mktToast('저장 실패 — 다시 시도해주세요.'); }
  }).catch(() => mktToast('저장 실패 — 인터넷 연결을 확인해주세요.'));
}

/* ===== <<PHOTO_META>> 블록 파싱 =====
   백엔드가 응답 끝에 아래 형식으로 붙여줌:
   <<PHOTO_META>>
   대표사진: 2 (건물 전면이 잘 보이는 풀샷)   ← 블로그 포맷일 때만 포함될 수 있음
   순서: 2,1,3
   1: 캡션텍스트
   2: 캡션텍스트
   3: 캡션텍스트
   <<END_PHOTO_META>>                                */
function mktParsePhotoMeta(text) {
  const m = text.match(/<<PHOTO_META>>([\s\S]*?)<<END_PHOTO_META>>/);
  if (!m) return { order: [], captions: {}, thumb: null, thumbReason: '', cleanText: text.trim() };
  const block = m[1];
  const orderMatch = block.match(/순서\s*[:：]\s*([\d,\s]+)/);
  const order = orderMatch
    ? orderMatch[1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
    : [];
  const captions = {};
  const capRe = /^\s*(\d+)\s*[:：]\s*(.+)$/gm;
  let cm;
  while ((cm = capRe.exec(block))) {
    captions[parseInt(cm[1], 10)] = cm[2].trim();
  }
  let thumb = null;
  let thumbReason = '';
  const thumbMatch = block.match(/대표사진\s*[:：]\s*(\d+)\s*(?:\(([^)]*)\))?/);
  if (thumbMatch) {
    thumb = parseInt(thumbMatch[1], 10);
    thumbReason = (thumbMatch[2] || '').trim();
  }
  const cleanText = text.replace(m[0], '').trim();
  return { order, captions, thumb, thumbReason, cleanText };
}

/* ===== 생성 ===== */
function mktSetBusy(busy) {
  mktBusy = busy;
  $('mktGenerateBtn').disabled = busy;
  $('mktGenerateLabel').textContent = busy ? '생성 중…' : '생성';
  $('mktOutputEmpty').classList.add('hidden');
  $('mktOutputLoading').classList.toggle('hidden', !busy);
  if (busy) {
    $('mktOutputText').classList.add('hidden');
    $('mktDownloadBtn').style.display = 'none';
    $('mktRefineRow').classList.add('hidden');
    $('mktRefineNote').textContent = '';
    $('mktThumbNote').classList.add('hidden');
  }
}

function mktShowError(msg) {
  const el = $('mktError');
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

async function mktGenerate() {
  if (mktBusy) return;
  const prompt = $('mktPrompt').value.trim();
  if (!prompt) { mktShowError('매물 특징을 먼저 입력해주세요.'); return; }
  if (!MKT_URL) { mktShowError('서버 주소가 설정되지 않았어요.'); return; }
  mktShowError('');
  mktSetBusy(true);
  mktConversation = [];
  mktRefineTurns = 0;

  const images = mktPhotos.map((p) => ({ mediaType: p.mediaType, data: p.base64 }));
  const payload = {
    mode: 'marketingGenerate',
    format: mktFormat,
    model: mktModel,
    prompt: prompt,
    images: images
  };

  try {
    const res = await fetch(MKT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    mktSetBusy(false);
    if (data && data.ok) {
      const parsed = mktParsePhotoMeta(data.text || '');
      const out = $('mktOutputText');
      out.textContent = parsed.cleanText;
      out.classList.remove('hidden');
      $('mktCopyBtn').disabled = false;

      mktLastGenPhotos = mktPhotos.slice();
      mktLastGenFormat = mktFormat;
      mktLastPhotoMeta = parsed;
      mktUpdateThumbNote(parsed);

      const dlBtn = $('mktDownloadBtn');
      if (mktLastGenPhotos.length > 0 && (parsed.order.length > 0 || Object.keys(parsed.captions).length > 0)) {
        dlBtn.style.display = '';
      } else {
        dlBtn.style.display = 'none';
      }

      // 다듬기용 대화 컨텍스트 시작 — 서버가 실제로 보낸 user turn(이미지 포함)을 그대로 이어받음
      mktConversation = [
        data.userTurn || { role: 'user', content: [{ type: 'text', text: prompt }] },
        { role: 'assistant', content: [{ type: 'text', text: data.text || '' }] }
      ];
      mktShowRefineBox();
    } else {
      mktShowError((data && data.error) || '생성에 실패했어요. 잠시 후 다시 시도해주세요.');
      $('mktOutputEmpty').classList.remove('hidden');
    }
  } catch (e) {
    mktSetBusy(false);
    mktShowError('네트워크 오류로 생성에 실패했어요.');
    $('mktOutputEmpty').classList.remove('hidden');
  }
}

function mktUpdateThumbNote(parsed) {
  const note = $('mktThumbNote');
  if (parsed && parsed.thumb) {
    note.textContent = `📌 대표(썸네일) 추천: 사진${parsed.thumb}${parsed.thumbReason ? ' — ' + parsed.thumbReason : ''}`;
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
}

function mktCopyOutput() {
  const text = $('mktOutputText').textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => mktToast('결과를 복사했어요.'))
    .catch(() => mktToast('복사에 실패했어요.'));
}

/* ===== 다듬기(대화형 후속 수정) ===== */
function mktResetConversation() {
  mktConversation = [];
  mktRefineTurns = 0;
  const row = $('mktRefineRow');
  const note = $('mktRefineNote');
  const input = $('mktRefineInput');
  if (row) row.classList.add('hidden');
  if (note) note.textContent = '';
  if (input) { input.value = ''; input.disabled = false; }
  const btn = $('mktRefineBtn');
  if (btn) btn.disabled = false;
}

function mktShowRefineBox() {
  const row = $('mktRefineRow');
  if (row) row.classList.remove('hidden');
  mktUpdateRefineNote();
}

function mktUpdateRefineNote() {
  const note = $('mktRefineNote');
  if (!note) return;
  const left = MKT_MAX_REFINE_TURNS - mktRefineTurns;
  if (left <= 0) {
    note.textContent = '다듬기는 여기까지예요 — 마음에 드는 방향이 안 나오면 매물 특징을 다시 정리해서 새로 생성해보세요.';
    $('mktRefineInput').disabled = true;
    $('mktRefineBtn').disabled = true;
  } else {
    note.textContent = `다듬기 ${mktRefineTurns}/${MKT_MAX_REFINE_TURNS}회 사용 · 이전 대화를 기억한 채로 이어서 수정해요.`;
  }
}

function mktSetRefineBusy(busy) {
  mktRefineBusy = busy;
  $('mktRefineBtn').disabled = busy || (MKT_MAX_REFINE_TURNS - mktRefineTurns <= 0);
  $('mktRefineBtn').textContent = busy ? '다듬는 중…' : '다듬기';
}

async function mktRefine() {
  if (mktRefineBusy || mktBusy) return;
  const input = $('mktRefineInput');
  const message = input.value.trim();
  if (!message) return;
  if (MKT_MAX_REFINE_TURNS - mktRefineTurns <= 0) return;
  if (!mktConversation.length) { mktToast('먼저 생성을 한 번 해주세요.'); return; }

  mktSetRefineBusy(true);
  mktShowError('');

  const payload = {
    mode: 'marketingRefine',
    format: mktFormat,
    model: mktModel,
    history: mktConversation,
    message: message
  };

  try {
    const res = await fetch(MKT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    mktSetRefineBusy(false);
    if (data && data.ok) {
      const parsed = mktParsePhotoMeta(data.text || '');
      const out = $('mktOutputText');
      out.textContent = parsed.cleanText;
      mktLastPhotoMeta = parsed;
      mktUpdateThumbNote(parsed);

      const dlBtn = $('mktDownloadBtn');
      if (mktLastGenPhotos.length > 0 && (parsed.order.length > 0 || Object.keys(parsed.captions).length > 0)) {
        dlBtn.style.display = '';
      } else {
        dlBtn.style.display = 'none';
      }

      mktConversation.push(data.userTurn || { role: 'user', content: [{ type: 'text', text: message }] });
      mktConversation.push({ role: 'assistant', content: [{ type: 'text', text: data.text || '' }] });
      mktRefineTurns += 1;
      input.value = '';
      mktUpdateRefineNote();
    } else {
      mktToast((data && data.error) || '다듬기에 실패했어요. 잠시 후 다시 시도해주세요.');
    }
  } catch (e) {
    mktSetRefineBusy(false);
    mktToast('네트워크 오류로 다듬기에 실패했어요.');
  }
}

/* ===== 사진 순서대로 파일명 정리 + zip 다운로드 ===== */
function mktBase64ToBlob(base64, mediaType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mediaType });
}

/* ===== 파일명용 키워드 슬러그 추출 =====
   블로그: [추천 태그] 섹션에서 앞의 1~2개 키워드
   인스타: 캡션 안 해시태그에서 앞의 1~2개
   네이버광고: 별도 태그 개념이 없어 슬러그 없이 포맷 라벨 사용            */
function mktSanitizeSlug(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '').slice(0, 40);
}
function mktExtractSlug(format, text) {
  try {
    if (format === 'blog') {
      const m = text.match(/\[추천\s*태그\]\s*\n([^\n]+)/);
      if (m) {
        const tags = m[1].split(',').map((s) => s.trim()).filter(Boolean);
        if (tags.length) return mktSanitizeSlug(tags.slice(0, 2).join('-'));
      }
    } else if (format === 'insta') {
      const tags = (text.match(/#[^\s#]+/g) || []).map((t) => t.slice(1));
      if (tags.length) return mktSanitizeSlug(tags.slice(0, 2).join('-'));
    }
  } catch (e) { /* 파싱 실패 시 그냥 포맷 라벨로 폴백 */ }
  return '';
}

async function mktDownloadPhotos() {
  if (typeof JSZip === 'undefined') { mktToast('zip 라이브러리를 불러오지 못했어요.'); return; }
  if (!mktLastGenPhotos.length) { mktToast('먼저 사진을 첨부해서 생성해주세요.'); return; }

  const meta = mktLastPhotoMeta || { order: [], captions: {} };
  // order가 비어있거나 사진 개수와 안 맞으면 업로드했던 원래 순서(1..n)로 대체
  let order = meta.order.filter((n) => n >= 1 && n <= mktLastGenPhotos.length);
  const uniqueOrder = [...new Set(order)];
  if (uniqueOrder.length !== mktLastGenPhotos.length) {
    order = mktLastGenPhotos.map((_, i) => i + 1);
  } else {
    order = uniqueOrder;
  }

  const zip = new JSZip();
  const rawText = $('mktOutputText').textContent || '';
  const slug = mktExtractSlug(mktLastGenFormat, rawText);
  const label = slug || MKT_FORMAT_LABEL[mktLastGenFormat] || '마케팅';
  const captionLines = [];

  order.forEach((origIdx, i) => {
    const photo = mktLastGenPhotos[origIdx - 1];
    if (!photo) return;
    const seq = String(i + 1).padStart(2, '0');
    const isThumb = meta.thumb && meta.thumb === origIdx;
    const filename = `${label}_${seq}${isThumb ? '_대표' : ''}.jpg`;
    const blob = mktBase64ToBlob(photo.base64, photo.mediaType);
    zip.file(filename, blob);
    const cap = meta.captions[origIdx];
    captionLines.push(`${filename}${cap ? ' : ' + cap : ''}`);
  });

  if (captionLines.length) zip.file('captions.txt', captionLines.join('\n'));

  try {
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label}_사진정리.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    mktToast('압축 파일 생성에 실패했어요.');
  }
}

/* ===== init ===== */
document.addEventListener('DOMContentLoaded', () => {
  mktRenderQuicklinks();

  document.querySelectorAll('#formatTabs .rec-filter-chip').forEach((btn) => {
    btn.addEventListener('click', () => mktSetFormat(btn.dataset.format));
  });
  document.querySelectorAll('#mktModelToggle .mkt-model-btn').forEach((btn) => {
    btn.addEventListener('click', () => mktSetModel(btn.dataset.model, true));
  });
  mktSetFormat('blog');
  mktSetModel(MKT_DEFAULT_MODEL.blog, false);

  const dropzone = $('mktDropzone');
  const fileInput = $('mktFileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { mktAddFiles(e.target.files); fileInput.value = ''; });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    mktAddFiles(e.dataTransfer.files);
  });

  $('mktSaveTemplate').addEventListener('click', mktSaveTemplate);
  $('mktSaveInstaTemplate').addEventListener('click', mktSaveInstaTemplate);
  $('mktGenerateBtn').addEventListener('click', mktGenerate);
  $('mktCopyBtn').addEventListener('click', mktCopyOutput);
  $('mktDownloadBtn').addEventListener('click', mktDownloadPhotos);
  $('mktRefineBtn').addEventListener('click', mktRefine);
  $('mktRefineInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mktRefine(); }
  });

  mktLoadConfig();
});
