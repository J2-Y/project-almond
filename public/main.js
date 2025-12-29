// public/main.js
const canvas = document.getElementById('lawn');
const ctx = canvas.getContext('2d', { alpha: false });

/**
 * 튜닝 포인트
 */
const CONFIG = {
  cell: 14, // 잔디 밀도(작을수록 촘촘, 성능은 조금 부담)
  bladesPerCell: 2, // 셀당 잔디 개수
  baseHeight: 18, // 기본 길이
  heightJitter: 14, // 길이 랜덤
  maxBend: 0.9, // 최대 휘어짐(라디안 근처 값처럼 쓰는 느낌)
  influenceRadius: 120, // 마우스 영향 반경(px)
  bendStrength: 0.012, // 마우스 속도 -> 휘어짐 힘
  relaxSpeed: 0.08, // 원복 속도(0~1, 클수록 빨리 돌아옴)
  swayDamping: 0.92, // 관성 감쇠(클수록 오래 출렁)
  butterflyChance: 0.06, // 스폰 확률(조건 충족 시)
  butterflyMinSpeed: 6, // 이 속도 이상일 때만 스폰 체크
  butterflyCooldownMs: 120, // 너무 연속으로 나오지 않게 쿨다운
};

let W = 0;
let H = 0;
let dpr = 1;

let gridCols = 0;
let gridRows = 0;

// 잔디 블레이드(잎) 목록: 각 잎은 위치/랜덤/휘어짐 상태를 가짐
let blades = [];

// 🦋 나비 목록
let butterflies = [];

// 나비 쿨타임
let lastButterflyAt = 0;

const BUTTERFLY_TYPES = [
  {
    name: 'yellow',
    body: 'rgba(120, 70, 20, 1)',
    wing: 'rgba(255, 220, 80, 1)',
    wing2: 'rgba(255, 245, 170, 0.9)', // 하이라이트
    sizeMin: 4,
    sizeMax: 7,
    lifeMin: 1400,
    lifeMax: 2300,
    speedMul: 1.0,
    wobbleMul: 1.0,
    flapMul: 1.0,
    pattern: 'flutter', // 기본
  },
  {
    name: 'blue',
    body: 'rgba(30, 40, 80, 1)',
    wing: 'rgba(110, 180, 255, 1)',
    wing2: 'rgba(190, 230, 255, 0.9)',
    sizeMin: 5,
    sizeMax: 9,
    lifeMin: 1600,
    lifeMax: 2800,
    speedMul: 0.95,
    wobbleMul: 1.2,
    flapMul: 1.1,
    pattern: 'glide', // 활공 느낌
  },
  {
    name: 'orange',
    body: 'rgba(90, 40, 10, 1)',
    wing: 'rgba(255, 140, 70, 1)',
    wing2: 'rgba(255, 220, 170, 0.9)',
    sizeMin: 4,
    sizeMax: 8,
    lifeMin: 1300,
    lifeMax: 2200,
    speedMul: 1.1,
    wobbleMul: 0.9,
    flapMul: 1.25,
    pattern: 'zigzag', // 지그재그
  },
  {
    name: 'night',
    body: 'rgba(240, 240, 255, 1)',
    wing: 'rgba(170, 160, 210, 1)',
    wing2: 'rgba(230, 220, 255, 0.85)',
    sizeMin: 6,
    sizeMax: 10,
    lifeMin: 1700,
    lifeMax: 3000,
    speedMul: 0.9,
    wobbleMul: 1.4,
    flapMul: 0.95,
    pattern: 'spiral', // 살짝 소용돌이
  },
];

// 타입 뽑기(가중치도 가능)
function pickButterflyType() {
  // 지금은 균등 랜덤
  return BUTTERFLY_TYPES[(Math.random() * BUTTERFLY_TYPES.length) | 0];
}

// 마우스 상태
const mouse = {
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  vx: 0,
  vy: 0,
  moved: false,
};

let isDragging = false;

canvas.addEventListener('pointerdown', (e) => {
  isDragging = true;
  canvas.setPointerCapture(e.pointerId); // 드래그 중 캔버스 밖으로 나가도 유지
  onPointerMove(e); // 누르는 순간 좌표 갱신(처음에 0,0 문제 예방)
});

canvas.addEventListener('pointerup', (e) => {
  isDragging = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch (_) {}
});

canvas.addEventListener('pointercancel', () => {
  isDragging = false;
});

function rand01(seed) {
  // seed 기반 의사난수(가벼운 해시)
  // Math.random() 대신 고정된 분포로 “잔디 모양이 리사이즈에도 덜 튀게” 도움
  const s = Math.sin(seed * 999.1337) * 43758.5453;
  return s - Math.floor(s);
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;

  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  buildField();
}

window.addEventListener('resize', resize);

function buildField() {
  blades = [];

  gridCols = Math.ceil(W / CONFIG.cell);
  gridRows = Math.ceil(H / CONFIG.cell);

  let id = 0;
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const cx = c * CONFIG.cell + CONFIG.cell * 0.5;
      const cy = r * CONFIG.cell + CONFIG.cell * 0.5;

      for (let k = 0; k < CONFIG.bladesPerCell; k++) {
        const seed = id * 1.37 + k * 91.77;

        const ox = (rand01(seed + 1.1) - 0.5) * CONFIG.cell * 0.8;
        const oy = (rand01(seed + 2.2) - 0.5) * CONFIG.cell * 0.8;

        const h =
          CONFIG.baseHeight +
          rand01(seed + 3.3) * CONFIG.heightJitter +
          (r / Math.max(1, gridRows - 1)) * 10; // 아래쪽이 살짝 더 길게

        blades.push({
          id,
          x: cx + ox,
          y: cy + oy,
          baseH: h,
          // 휘어짐 상태 (bend는 현재, bendV는 관성/속도)
          bend: 0,
          bendV: 0,
          // 잎마다 기본 기울기/굵기 차이
          lean: (rand01(seed + 4.4) - 0.5) * 0.25,
          thick: 0.8 + rand01(seed + 5.5) * 0.9,
          // 색 변화용(밝기)
          tint: 0.75 + rand01(seed + 6.6) * 0.25,

          growth: 1,
          pluckedUntil: 0,
        });
      }

      id++;
    }
  }
}

function onPointerMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  mouse.px = mouse.x;
  mouse.py = mouse.y;
  mouse.x = x;
  mouse.y = y;

  mouse.vx = mouse.x - mouse.px;
  mouse.vy = mouse.y - mouse.py;
  mouse.moved = true;
}

// window.addEventListener('pointermove', onPointerMove, { passive: true });
canvas.addEventListener('pointermove', onPointerMove, { passive: true });

function applyMouseWind() {
  if (!mouse.moved) return;

  const speed = Math.hypot(mouse.vx, mouse.vy);
  if (speed < 0.01) return;

  const R = CONFIG.influenceRadius;
  const R2 = R * R;

  // 마우스 속도 방향(정규화)
  const inv = 1 / (speed || 1);
  const dx = mouse.vx * inv;
  const dy = mouse.vy * inv;

  // 잔디가 “이동 방향 반대쪽으로 눕는” 느낌을 주기 위해
  // dy(위아래)보다 dx(좌우)에 조금 더 반응하게 가중치 줄 수도 있음.
  // 여기서는 단순히 dx를 사용해 좌우 흔들림을 강조해봄.
  const push = Math.min(40, speed) * CONFIG.bendStrength;

  for (let i = 0; i < blades.length; i++) {
    const b = blades[i];
    const tx = b.x - mouse.x;
    const ty = b.y - mouse.y;
    const d2 = tx * tx + ty * ty;
    if (d2 > R2) continue;

    // 거리 감쇠(가까울수록 영향 큼)
    const t = 1 - d2 / R2;
    const falloff = t * t;

    // 바람 방향 성분을 bendV로 “밀어 넣기”
    // dx 위주로 휘게 하면 잔디가 좌우로 흔들리는 체감이 큼
    const dir = dx * 1.0 + dy * 0.35;

    b.bendV += push * falloff * dir;
  }

  // 🦋 나비 스폰 트리거: 마우스가 일정 속도 이상으로 움직일 때 확률 체크
  const now = performance.now();
  if (speed >= CONFIG.butterflyMinSpeed) {
    // 속도가 빠를수록 강도 증가
    const intensity = Math.min(2, speed / 18);

    // 확률은 속도에 따라 조금 가중
    const p = CONFIG.butterflyChance * intensity;

    if (Math.random() < p) {
      // 마우스 근처에서 살짝 랜덤 위치에 등장
      const sx = mouse.x + (Math.random() - 0.5) * 14;
      const sy = mouse.y + (Math.random() - 0.5) * 14;
      spawnButterfly(sx, sy, intensity);
    }
  }

  // 다음 프레임에서도 계속 누적되는 걸 막기 위해 moved 리셋
  mouse.moved = false;
}

function updateBlades() {
  const now = performance.now();

  for (let b of blades) {
    // 🌱 재성장
    if (now > b.pluckedUntil && b.growth < 1) {
      b.growth += 0.008; // 성장 속도
      if (b.growth > 1) b.growth = 1;
    }

    b.bendV *= CONFIG.swayDamping;
    b.bendV += (0 - b.bend) * CONFIG.relaxSpeed;
    b.bend += b.bendV;

    if (b.bend > CONFIG.maxBend) b.bend = CONFIG.maxBend;
    if (b.bend < -CONFIG.maxBend) b.bend = -CONFIG.maxBend;
  }
}

function updateButterflies() {
  const now = performance.now();

  for (let i = butterflies.length - 1; i >= 0; i--) {
    const b = butterflies[i];
    const age = now - b.bornAt;
    const t = age / b.lifeMs;

    if (t >= 1) {
      butterflies.splice(i, 1);
      continue;
    }

    // 패턴별 추가 힘(가속)
    b.ax = 0;
    b.ay = 0;

    // 기본적으로 조금 위로, 시간이 갈수록 약간 느슨해지는 느낌
    b.ay += 0.02; // 중력(아래로)
    b.phase += 0.18 + 0.08 * Math.random();

    const wob = Math.sin(b.phase) * b.wobble;

    switch (b.type.pattern) {
      case 'flutter': {
        // 기본: 좌우 흔들 + 살짝 상승 유지
        b.ax += wob * 0.06;
        b.ay -= 0.015 * (1 - t);
        break;
      }
      case 'glide': {
        // 활공: 초반에 슉 올라가고, 이후엔 부드럽게 떠다님
        b.ax += wob * 0.035;
        b.ay -= 0.03 * (1 - t) + Math.sin(b.phase * 0.5) * 0.01;
        // 속도 감쇠로 더 "글라이드" 느낌
        b.vx *= 0.995;
        break;
      }
      case 'zigzag': {
        // 지그재그: 방향 전환이 좀 더 과격
        const zig = Math.sign(Math.sin(b.phase * 1.2)) * b.wobble;
        b.ax += zig * 0.09;
        b.ay -= 0.02 * (1 - t);
        break;
      }
      case 'spiral': {
        // 소용돌이: 원형으로 살짝 감기는 느낌
        b.ax += Math.cos(b.phase) * b.wobble * 0.05;
        b.ay += Math.sin(b.phase) * b.wobble * 0.03 - 0.02 * (1 - t);
        b.rot += 0.02;
        break;
      }
    }

    // 적분(가속 -> 속도 -> 위치)
    b.vx += b.ax;
    b.vy += b.ay;

    b.x += b.vx;
    b.y += b.vy;

    // 화면 위로 너무 빨리 사라지면 약간 느리게
    if (b.y < -40) b.vy += 0.08;

    // 페이드아웃
    b.alpha = 1 - Math.pow(t, 2);
  }
}

function drawBackground() {
  // 잔디 배경(단색 + 살짝 명암)
  ctx.fillStyle = '#1e7a3a';
  ctx.fillRect(0, 0, W, H);

  // 바닥 음영: 아래쪽이 살짝 어둡게 (간단한 그라데이션 흉내)
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#0b3b1d';
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
  ctx.globalAlpha = 1;
}

function drawBlades() {
  // 잔디는 선(stroke)로 그리는 게 싸고 예쁨
  ctx.lineCap = 'round';

  for (let i = 0; i < blades.length; i++) {
    const b = blades[i];

    // 각 잎은 아래에서 위로 뻗는 선.
    // bend가 커질수록 끝점이 옆으로 이동.
    // const h = b.baseH;
    const h = b.baseH * b.growth;
    if (h < 1) continue;

    const baseX = b.x;
    const baseY = b.y;

    // 기울기: 기본 lean + 현재 bend
    const bend = b.lean + b.bend;

    // 끝점
    const tipX = baseX + Math.sin(bend) * h;
    const tipY = baseY - Math.cos(bend) * h;

    // 중간 제어점(곡선 느낌을 살짝 주기)
    const midX = baseX + Math.sin(bend) * (h * 0.55);
    const midY = baseY - Math.cos(bend) * (h * 0.55);

    // 굵기
    ctx.lineWidth = b.thick;

    // 색: tint로 약간씩 변주
    // (완전 랜덤 컬러로 두면 얼룩져서, 밝기만 흔드는 게 자연스러움)
    const g = Math.floor(120 + 90 * b.tint);
    const r = Math.floor(20 + 10 * b.tint);
    const bl = Math.floor(30 + 15 * b.tint);
    ctx.strokeStyle = `rgb(${r}, ${g}, ${bl})`;

    ctx.beginPath();
    ctx.moveTo(baseX, baseY);

    // quadratic curve로 끝점까지
    ctx.quadraticCurveTo(midX, midY, tipX, tipY);
    ctx.stroke();
  }
}

function drawButterflies() {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < butterflies.length; i++) {
    const b = butterflies[i];
    const type = b.type;

    ctx.globalAlpha = b.alpha;

    const s = b.size;
    // flap: 날갯짓 (타입별 배수)
    const flap =
      (0.55 + 0.45 * Math.sin((b.phase + b.flapSeed) * 2.4)) * type.flapMul;

    // 날개 두께는 크기에 따라
    ctx.lineWidth = Math.max(1.2, s * 0.25);

    // 기본 날개
    ctx.strokeStyle = type.wing;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.quadraticCurveTo(
      b.x - s * 1.3,
      b.y - s * flap,
      b.x - s * 0.15,
      b.y + s * 0.65
    );
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.quadraticCurveTo(
      b.x + s * 1.3,
      b.y - s * flap,
      b.x + s * 0.15,
      b.y + s * 0.65
    );
    ctx.stroke();

    // 하이라이트(얇게 한 번 더)
    ctx.globalAlpha = b.alpha * 0.7;
    ctx.lineWidth = Math.max(0.9, s * 0.14);
    ctx.strokeStyle = type.wing2;

    ctx.beginPath();
    ctx.moveTo(b.x - s * 0.08, b.y - 0.5);
    ctx.quadraticCurveTo(
      b.x - s * 0.95,
      b.y - s * flap * 0.85,
      b.x - s * 0.05,
      b.y + s * 0.45
    );
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(b.x + s * 0.08, b.y - 0.5);
    ctx.quadraticCurveTo(
      b.x + s * 0.95,
      b.y - s * flap * 0.85,
      b.x + s * 0.05,
      b.y + s * 0.45
    );
    ctx.stroke();

    // 몸통
    ctx.globalAlpha = b.alpha;
    ctx.strokeStyle = type.body;
    ctx.lineWidth = Math.max(1, s * 0.18);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y - 2);
    ctx.lineTo(b.x, b.y + 4 + s * 0.15);
    ctx.stroke();
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

// 잔디 뽑기 로직
function pluckGrass() {
  if (!isDragging) return;

  if (isDragging) {
    // 화면 좌상단에 빨간 점으로 "드래그 인식" 표시
    ctx.fillStyle = 'red';
    ctx.fillRect(10, 10, 10, 10);
  }

  const R = 18;
  const R2 = R * R;
  const now = performance.now();

  for (let b of blades) {
    const dx = b.x - mouse.x;
    const dy = b.y - mouse.y;
    if (dx * dx + dy * dy > R2) continue;

    // 이미 뽑혀 있으면 무시
    if (b.growth <= 0.05) continue;

    b.growth = 0;
    b.pluckedUntil = now + 2000; // 2초 후부터 재성장
    b.bend = 0;
    b.bendV = 0;
  }
}

// 나비 소환
function spawnButterfly(x, y, intensity = 1) {
  const now = performance.now();

  if (now - lastButterflyAt < CONFIG.butterflyCooldownMs) return;
  lastButterflyAt = now;

  const type = pickButterflyType();

  const size = type.sizeMin + Math.random() * (type.sizeMax - type.sizeMin);

  const lifeMs = type.lifeMin + Math.random() * (type.lifeMax - type.lifeMin);

  // 시작 속도(위로 날아가며, 약간 랜덤)
  const vx = (Math.random() - 0.5) * 2.0 * (0.8 + intensity) * type.speedMul;
  const vy =
    -(2.4 + Math.random() * 2.0) * (0.9 + intensity * 0.3) * type.speedMul;

  butterflies.push({
    type,
    x,
    y,
    vx,
    vy,
    ax: 0,
    ay: 0,

    // 흔들림/날갯짓
    phase: Math.random() * Math.PI * 2,
    wobble: (0.8 + Math.random() * 1.6) * type.wobbleMul,
    flapSeed: Math.random() * 10,

    bornAt: now,
    lifeMs,
    size,
    alpha: 1,
    rot: (Math.random() - 0.5) * 0.8, // 살짝 회전 느낌용
  });
}

function loop() {
  applyMouseWind();
  pluckGrass();
  updateBlades();
  updateButterflies();

  drawBackground();
  drawBlades();
  drawButterflies();

  requestAnimationFrame(loop);
}

// 시작
resize();
loop();
