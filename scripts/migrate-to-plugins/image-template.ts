// Wrap a `prompt-templates/image/<id>.json` entry as a bundled plugin
// under `plugins/_official/image-templates/<plugin-id>/`. The wrapper
// preserves the original JSON beside the manifest so attribution,
// preview URLs, and the {argument …} placeholders stay accessible to
// the daemon's generator and to anyone auditing the plugin.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  PLUGINS_ROOT,
  PROMPT_TEMPLATES_DIR,
  TIER_IMAGE_TEMPLATES,
  buildManifest,
  copyFile,
  dedupeTags,
  pluginName,
  writeManifest,
  type RunStats,
} from './lib.ts';

interface ImageTemplateJson {
  id?: string;
  surface?: string;
  title?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  model?: string;
  aspect?: string;
  prompt?: string;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  importedAt?: string;
  localizedPrompts?: Record<string, string>;
  source?: { repo?: string; license?: string; author?: string; url?: string };
}

export interface ImageTemplateOptions {
  ids?: string[];
  limit?: number;
  dryRun?: boolean;
}

export async function runImageTemplateGenerator(opts: ImageTemplateOptions): Promise<RunStats> {
  return runJsonTemplateGenerator({
    sourceDir: path.join(PROMPT_TEMPLATES_DIR, 'image'),
    targetTier: TIER_IMAGE_TEMPLATES,
    namePrefix: 'image-template',
    mode: 'image',
    surface: 'image',
    atom: 'image-generate',
    capability: 'media:image-generate',
    aspectOptions: ['1:1', '16:9', '9:16', '4:5', '3:2'],
    defaultAspect: '1:1',
    previewType: 'image',
    ...opts,
  });
}

export interface VideoTemplateOptions extends ImageTemplateOptions {}

export async function runVideoTemplateGenerator(opts: VideoTemplateOptions): Promise<RunStats> {
  return runJsonTemplateGenerator({
    sourceDir: path.join(PROMPT_TEMPLATES_DIR, 'video'),
    targetTier: 'video-templates',
    namePrefix: 'video-template',
    mode: 'video',
    surface: 'video',
    atom: 'video-generate',
    capability: 'media:video-generate',
    aspectOptions: ['16:9', '9:16', '1:1', '4:5'],
    defaultAspect: '16:9',
    previewType: 'video',
    ...opts,
  });
}

interface SharedConfig {
  sourceDir: string;
  targetTier: string;
  namePrefix: string;
  mode: 'image' | 'video';
  surface: 'image' | 'video';
  atom: string;
  capability: string;
  aspectOptions: string[];
  defaultAspect: string;
  previewType: 'image' | 'video';
  ids?: string[];
  limit?: number;
  dryRun?: boolean;
}

async function runJsonTemplateGenerator(cfg: SharedConfig): Promise<RunStats> {
  const { readdir } = await import('node:fs/promises');
  const stats: RunStats = { generated: [], skipped: [] };
  let entries: string[];
  try {
    entries = await readdir(cfg.sourceDir);
  } catch {
    return stats;
  }
  const filtered = entries
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !cfg.ids || cfg.ids.includes(basenameNoExt(f)))
    .sort();
  const slice = cfg.limit !== undefined ? filtered.slice(0, cfg.limit) : filtered;

  for (const file of slice) {
    const filePath = path.join(cfg.sourceDir, file);
    const raw = await readFile(filePath, 'utf8');
    let parsed: ImageTemplateJson;
    try {
      parsed = JSON.parse(raw) as ImageTemplateJson;
    } catch (err) {
      stats.skipped.push({ id: file, reason: `invalid json: ${(err as Error).message}` });
      continue;
    }
    if (!parsed.id || !parsed.title || !parsed.prompt) {
      stats.skipped.push({ id: file, reason: 'missing id/title/prompt' });
      continue;
    }
    if (parsed.surface !== cfg.surface) {
      stats.skipped.push({ id: parsed.id, reason: `surface=${parsed.surface} mismatch` });
      continue;
    }

    const name = pluginName(cfg.namePrefix, parsed.id);
    const folder = path.join(PLUGINS_ROOT, cfg.targetTier, parsed.id);

    const manifest = buildManifest({
      name,
      title: parsed.title,
      description: parsed.summary ?? '',
      license: parsed.source?.license ?? 'CC-BY-4.0',
      author: {
        ...(parsed.source?.author ? { name: parsed.source.author } : {}),
        ...(parsed.source?.url ? { url: parsed.source.url } : {}),
      },
      ...(parsed.source?.repo
        ? { homepage: `https://github.com/${parsed.source.repo}` }
        : {}),
      tags: dedupeTags([
        cfg.namePrefix,
        'first-party',
        cfg.surface,
        parsed.category,
        ...(parsed.tags ?? []),
      ]),
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        mode: cfg.mode,
        scenario: cfg.surface,
        surface: cfg.surface,
        ...(parsed.importedAt ? { importedAt: parsed.importedAt } : {}),
        localized: {
          ko: {
            title: koreanTemplateTitle(parsed.title),
            description: koreanTemplateDescription(parsed, cfg.surface),
          },
        },
        preview: previewBlock(parsed, cfg.previewType),
        useCase: { query: useCaseQuery(parsed) },
        inputs: [
          ...(parsed.model
            ? [{
                name: 'model',
                label: 'Model',
                type: 'select' as const,
                options: [parsed.model],
                default: parsed.model,
              }]
            : []),
          {
            name: 'aspect',
            label: 'Aspect ratio',
            type: 'select' as const,
            options: cfg.aspectOptions,
            default: parsed.aspect ?? cfg.defaultAspect,
          },
        ],
        context: { assets: ['./template.json'] },
        pipeline: {
          stages: [{ id: 'generate', atoms: [cfg.atom] }],
        },
        capabilities: ['prompt:inject', cfg.capability],
      },
    });

    if (cfg.dryRun) {
      stats.generated.push(parsed.id);
      continue;
    }
    await writeManifest(folder, manifest);
    await copyFile(filePath, path.join(folder, 'template.json'));
    stats.generated.push(parsed.id);
  }
  return stats;
}

function basenameNoExt(file: string): string {
  return file.replace(/\.[^.]+$/, '');
}

function previewBlock(parsed: ImageTemplateJson, type: 'image' | 'video'): Record<string, unknown> | undefined {
  const block: Record<string, unknown> = { type };
  if (parsed.previewImageUrl) block.poster = parsed.previewImageUrl;
  if (parsed.previewVideoUrl) block.video = parsed.previewVideoUrl;
  return Object.keys(block).length > 1 ? block : undefined;
}

function useCaseQuery(parsed: ImageTemplateJson): string | Record<string, string> {
  const localized = Object.fromEntries(
    Object.entries(parsed.localizedPrompts ?? {})
      .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
      .map(([locale, value]) => [locale, value.trim()]),
  );
  if (Object.keys(localized).length === 0) return parsed.prompt ?? '';
  return {
    en: parsed.prompt ?? '',
    ...localized,
  };
}

function koreanTemplateTitle(title: string): string {
  const [rawCategory = '', ...rest] = title.split(/\s+-\s+/);
  const body = rest.join(' - ') || rawCategory;
  const category = rest.length > 0 ? `${translateCategory(rawCategory)} - ` : '';
  return `${category}${translateTitleWords(body)}`;
}

function koreanTemplateDescription(parsed: ImageTemplateJson, surface: 'image' | 'video'): string {
  const title = koreanTemplateTitle(parsed.title ?? parsed.id ?? '템플릿');
  const model = parsed.model ? `${parsed.model} ` : '';
  const medium = surface === 'video' ? '비디오' : '이미지';
  const category = parsed.category ? `${translateCategory(parsed.category)} ` : '';
  return `${model}${medium} 생성을 위한 ${category}프롬프트 템플릿입니다. 카드 제목과 설명은 한국어로 표시하지만 프롬프트 본문은 원문을 유지합니다.`;
}

function translateCategory(value: string): string {
  const normalized = value.trim().toLowerCase();
  const map: Record<string, string> = {
    'profile / avatar': '프로필 / 아바타',
    'social media post': '소셜 미디어 포스트',
    'game screenshot': '게임 스크린샷',
    'game ui': '게임 UI',
    'illustration': '일러스트레이션',
    'infographic': '인포그래픽',
    'k-editorial': 'K-에디토리얼',
    'k-food': 'K-푸드',
    'luxury cosmetic': '럭셔리 코스메틱',
    'minimal product poster': '미니멀 제품 포스터',
    'startup pitch': '스타트업 피치',
    'webtoon': '웹툰',
    'video': '비디오',
    'hyperframes': '하이퍼프레임',
  };
  return map[normalized] ?? translateTitleWords(value);
}

function translateTitleWords(value: string): string {
  const phraseMap: Array<[RegExp, string]> = [
    [/\bprofile\b/gi, '프로필'],
    [/\bavatar\b/gi, '아바타'],
    [/\bsocial media\b/gi, '소셜 미디어'],
    [/\bpost\b/gi, '포스트'],
    [/\bgame\b/gi, '게임'],
    [/\bscreenshot\b/gi, '스크린샷'],
    [/\banime\b/gi, '애니메이션'],
    [/\bcinematic\b/gi, '시네마틱'],
    [/\bportrait\b/gi, '포트레이트'],
    [/\bphoto\b/gi, '사진'],
    [/\bphotorealistic\b/gi, '실사형'],
    [/\brealistic\b/gi, '현실적인'],
    [/\bselfie\b/gi, '셀피'],
    [/\bfashion\b/gi, '패션'],
    [/\beditorial\b/gi, '에디토리얼'],
    [/\bposter\b/gi, '포스터'],
    [/\bcover\b/gi, '커버'],
    [/\billustration\b/gi, '일러스트레이션'],
    [/\bcharacter\b/gi, '캐릭터'],
    [/\bfantasy\b/gi, '판타지'],
    [/\bwoman\b/gi, '여성'],
    [/\bman\b/gi, '남성'],
    [/\bgirl\b/gi, '소녀'],
    [/\bboy\b/gi, '소년'],
    [/\bjapanese\b/gi, '일본풍'],
    [/\bkorean\b/gi, '한국풍'],
    [/\bmodern\b/gi, '모던'],
    [/\bvintage\b/gi, '빈티지'],
    [/\bretro\b/gi, '레트로'],
    [/\bcyberpunk\b/gi, '사이버펑크'],
    [/\bwatercolor\b/gi, '수채화'],
    [/\bminimalist\b/gi, '미니멀'],
    [/\bluxury\b/gi, '럭셔리'],
    [/\bproduct\b/gi, '제품'],
    [/\bcommercial\b/gi, '광고'],
    [/\bsequence\b/gi, '시퀀스'],
    [/\bscene\b/gi, '장면'],
    [/\btransformation\b/gi, '변신'],
    [/\bmotion\b/gi, '모션'],
    [/\bgraphics\b/gi, '그래픽'],
    [/\bshowcase\b/gi, '쇼케이스'],
    [/\bpromo\b/gi, '프로모션'],
    [/\btrailer\b/gi, '트레일러'],
    [/\bapp\b/gi, '앱'],
    [/\bicons?\b/gi, '아이콘'],
    [/\bempty states\b/gi, '빈 상태'],
    [/\bdashboard\b/gi, '대시보드'],
  ];
  let out = value.replace(/-/g, ' ');
  for (const [pattern, replacement] of phraseMap) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/\s+/g, ' ').trim();
  return /[A-Za-z]{3,}/.test(out) ? koreanFromSlugLike(value) : out;
}

function koreanFromSlugLike(value: string): string {
  const tokenMap: Record<string, string> = {
    '3d': '3D',
    '8k': '8K',
    ai: '인공지능',
    ui: '인터페이스',
    arpg: '액션 RPG',
    mmo: '온라인 RPG',
    hud: 'HUD',
    c4d: '3D',
    kv: '키비주얼',
    app: '앱',
    apps: '앱',
    icon: '아이콘',
    icons: '아이콘',
    stone: '석재',
    staircase: '계단',
    evolution: '진화',
    infographic: '인포그래픽',
    anime: '애니메이션',
    martial: '무술',
    battle: '전투',
    architecture: '건축',
    mood: '무드',
    render: '렌더',
    korea: '한국',
    dopamine: '도파민',
    cyclist: '자전거 라이더',
    wheelie: '휠리',
    commerce: '커머스',
    live: '라이브',
    stream: '스트림',
    mockup: '목업',
    friendly: '친근한',
    fighting: '격투',
    captain: '캡틴',
    three: '삼국지',
    kingdoms: '삼국지',
    guanyu: '관우',
    guan: '관우',
    yu: '관우',
    yanliang: '안량',
    yan: '안량',
    liang: '안량',
    lyubu: '여포',
    'lü': '여포',
    bu: '여포',
    yuanmen: '원문',
    archery: '활쏘기',
    zhaoyun: '조운',
    zhao: '조운',
    yun: '조운',
    cradle: '아기 구출',
    escape: '탈출',
    changbanpo: '장판파',
    ancient: '고대',
    china: '중국',
    open: '오픈',
    world: '월드',
    illustrated: '일러스트',
    city: '도시',
    food: '푸드',
    map: '지도',
    crayon: '크레용',
    kid: '아이',
    drawing: '드로잉',
    rework: '리워크',
    bichon: '비숑',
    shop: '숍',
    flash: '플래시',
    chat: '채팅',
    flower: '꽃',
    delivery: '배송',
    audiobook: '오디오북',
    quick: '퀵',
    vocabulary: '단어장',
    whiskey: '위스키',
    glass: '잔',
    fast: '패스트',
    states: '상태',
    ecommerce: '이커머스',
    general: '범용',
    reading: '독서',
    social: '소셜',
    clay: '클레이',
    arcade: '아케이드',
    hello: '인사',
    muzik: '뮤직',
    radio: '라디오',
    smooth: '스무스',
    blender: '블렌더',
    vending: '자판기',
    machine: '기계',
    vinyl: '바이닐',
    player: '플레이어',
    gift: '선물',
    haul: '하울',
    office: '오피스',
    rush: '러시',
    present: '선물',
    dash: '대시',
    saas: 'SaaS',
    workspace: '워크스페이스',
    skater: '스케이터',
    idea: '아이디어',
    traveler: '여행자',
    exaggerated: '과장된',
    bounce: '바운스',
    bike: '자전거',
    trick: '트릭',
    camping: '캠핑',
    invite: '초대',
    designer: '디자이너',
    stylus: '스타일러스',
    dog: '강아지',
    walk: '산책',
    pastel: '파스텔',
    leap: '점프',
    strawberry: '딸기',
    rocker: '로커',
    beauty: '뷰티',
    cosmetics: '화장품',
    fitness: '피트니스',
    equipment: '장비',
    ingredients: '재료',
    audio: '오디오',
    productivity: '생산성',
    ops: '운영',
    join: '채용',
    us: '우리',
    recruitment: '채용',
    may: '5월',
    day: '데이',
    girl: '소녀',
    island: '섬',
    tent: '텐트',
    mountain: '산',
    play: '놀이',
    wild: '와일드',
    skateboard: '스케이트보드',
    urban: '도시',
    nomad: '노마드',
    project: '프로젝트',
    vacation: '휴가',
    guide: '가이드',
    youth: '청춘',
    carnival: '카니발',
    morning: '아침',
    breakfast: '아침식사',
    life: '라이프',
    festival: '페스티벌',
    weekend: '주말',
    posters: '포스터',
    algorithm: '알고리즘',
    fog: '안개',
    art: '아트',
    daydream: '백일몽',
    worker: '직장인',
    information: '정보',
    overload: '과부하',
    new: '새로운',
    intelligence: '지능',
    recycle: '재활용',
    rebuild: '재건',
    tomorrow: '내일',
    refuse: '거부',
    involution: '내권화',
    stay: '집중',
    focused: '집중',
    cold: '냉전',
    war: '전쟁',
    collage: '콜라주',
    sonic: '사운드',
    graphic: '그래픽',
    design: '디자인',
    exhibition: '전시',
    arts: '아트',
    neo: '네오',
    creation: '창작',
    realm: '영역',
    pet: '펫',
    market: '마켓',
    vintage: '빈티지',
    pink: '핑크',
    yellow: '옐로',
    gradient: '그라데이션',
    infinite: '무한',
    love: '사랑',
    marathon: '마라톤',
    floral: '플로럴',
    guitar: '기타',
    summer: '여름',
    bubble: '버블',
    lab: '랩',
    plan: '플랜',
    music: '음악',
    confession: '고백',
    balloon: '풍선',
    snowfall: '눈',
    fire: '불꽃',
    sunny: '맑은',
    tech: '테크',
    future: '미래',
    breakthrough: '돌파',
    hackathon: '해커톤',
    loading: '로딩',
    super: '슈퍼',
    developer: '개발자',
    launch: '런칭',
    tempted: '유혹',
    hearts: '하트',
    wanderer: '방랑자',
    otaku: '오타쿠',
    dance: '댄스',
    choreography: '안무',
    breakdown: '분해',
    panels: '패널',
    editorial: '에디토리얼',
    magazine: '매거진',
    menu: '메뉴',
    luxury: '럭셔리',
    cosmetic: '코스메틱',
    campaign: '캠페인',
    visual: '비주얼',
    product: '제품',
    brand: '브랜드',
    explainer: '설명',
    slide: '슬라이드',
    hybrid: '하이브리드',
    style: '스타일',
    notion: '노션',
    team: '팀',
    dashboard: '대시보드',
    artifact: '아티팩트',
    profile: '프로필',
    avatar: '아바타',
    cinematic: '시네마틱',
    photo: '사진',
    street: '스트리트',
    fashion: '패션',
    anonymized: '익명화',
    cosplay: '코스프레',
    selfie: '셀피',
    candid: '캔디드',
    identity: '아이덴티티',
    reference: '레퍼런스',
    casual: '캐주얼',
    grid: '그리드',
    photoshoot: '화보',
    censored: '검열',
    character: '캐릭터',
    familiar: '동반자',
    selection: '선택',
    logic: '로직',
    abandoned: '버려진',
    room: '방',
    early: '초여름',
    japanese: '일본풍',
    hotel: '호텔',
    prompt: '프롬프트',
    south: '남아시아',
    asian: '아시아',
    male: '남성',
    cyberpunk: '사이버펑크',
    neon: '네온',
    face: '얼굴',
    text: '텍스트',
    elegant: '우아한',
    ethereal: '몽환적인',
    blue: '블루',
    haired: '헤어',
    expressive: '표정',
    woman: '여성',
    emoji: '이모지',
    sticker: '스티커',
    pack: '팩',
    extreme: '익스트림',
    close: '클로즈업',
    laughing: '웃는',
    couple: '커플',
    glamorous: '글래머',
    golden: '골든',
    hour: '아워',
    privacy: '프라이버시',
    hyper: '하이퍼',
    texture: '텍스처',
    ink: '잉크',
    splatter: '스플래터',
    graffiti: '그래피티',
    polaroid: '폴라로이드',
    lavender: '라벤더',
    mage: '마법사',
    low: '로우',
    poly: '폴리',
    origami: '오리가미',
    papercraft: '페이퍼크래프트',
    macro: '매크로',
    monochrome: '모노크롬',
    studio: '스튜디오',
    old: '오래된',
    restoration: '복원',
    dslr: 'DSLR',
    poetic: '시적인',
    professional: '전문',
    wallpaper: '월페이퍼',
    imperfect: '불완전한',
    signed: '사인',
    marker: '마커',
    snow: '눈',
    rabbit: '토끼',
    mask: '마스크',
    hanfu: '한푸',
    spirit: '정령',
    song: '송나라',
    dynasty: '왕조',
    subway: '지하철',
    corridor: '복도',
    drenched: '햇살 가득한',
    curve: '곡면',
    mirror: '거울',
    reflection: '반사',
    blurred: '블러',
    esports: 'e스포츠',
    audience: '관객',
    crowd: '군중',
    shot: '샷',
    spa: '스파',
    elevator: '엘리베이터',
    confused: '혼란스러운',
    elf: '엘프',
    desk: '책상',
    photography: '사진',
    imperial: '제국',
    marshal: '원수',
    commander: '지휘관',
    train: '열차',
    schoolgirl: '여학생',
    phone: '휴대폰',
    recording: '녹화',
    angle: '앵글',
    futuristic: '미래적',
    matchstick: '성냥개비',
    architectural: '건축',
    psg: 'PSG',
    announcement: '발표',
    sensational: '감각적인',
    storyboard: '스토리보드',
    shots: '샷',
    showa: '쇼와',
    culture: '문화',
    travel: '여행',
    snapshot: '스냅샷',
    sign: '간판',
    painter: '화가',
    sketch: '스케치',
    rooftop: '루프탑',
    whimsical: '기발한',
    pirate: '해적',
    ship: '배',
    deck: '덱',
    grunge: '그런지',
    pitch: '피치',
    hero: '히어로',
    headset: '헤드셋',
    exploded: '분해도',
    view: '뷰',
    webtoon: '웹툰',
    key: '키',
    animated: '애니메이션',
    building: '조립',
    lego: '레고',
    decade: '10년',
    refinement: '정제',
    glow: '글로우업',
    spacecraft: '우주선',
    reactivation: '재가동',
    guardian: '수호자',
    dragon: '드래곤',
    rescue: '구출',
    indian: '인도',
    kingdom: '왕국',
    fpv: '1인칭',
    animation: '애니메이션',
    transfer: '전환',
    camera: '카메라',
    tracking: '트래킹',
    antique: '앤티크',
    transformation: '변신',
    host: '호스트',
    authentic: '리얼',
    grwm: 'GRWM',
    influencer: '인플루언서',
    reel: '릴스',
    baseball: '야구',
    stadium: '경기장',
    spectator: '관중',
    beat: '비트',
    synced: '싱크',
    outfit: '의상',
    intro: '인트로',
    birthday: '생일',
    celebration: '축하',
    cozy: '아늑한',
    rain: '비',
    emotional: '감정',
    homemade: '홈메이드',
    pizza: '피자',
    marine: '해양',
    biologist: '생물학자',
    exploration: '탐험',
    podcast: '팟캐스트',
    technique: '테크닉',
    navigation: '내비게이션',
    racing: '레이싱',
    vampire: '뱀파이어',
    alley: '골목',
    colossal: '거대',
    entity: '존재',
    megacity: '메가시티',
    crimson: '크림슨',
    horizon: '호라이즌',
    sci: 'SF',
    fi: '',
    cybernetic: '사이버네틱',
    duel: '결투',
    trailer: '트레일러',
    script: '스크립트',
    tokyo: '도쿄',
    underground: '지하',
    shrine: '신사',
    dark: '다크',
    horror: '호러',
    forbidden: '자금성',
    satire: '풍자',
    dubai: '두바이',
    warrior: '전사',
    giant: '거대',
    walking: '이동',
    nomadic: '유목',
    historical: '역사',
    hollywood: '할리우드',
    haute: '오트',
    couture: '쿠튀르',
    hunched: '웅크린',
    hypercar: '하이퍼카',
    vfx: 'VFX',
    hyperframes: '하이퍼프레임',
    phones: '폰',
    sizzle: '시즐',
    bar: '바',
    race: '레이스',
    flight: '비행',
    route: '경로',
    canvas: '캔버스',
    iphone: '아이폰',
    liquid: '리퀴드',
    background: '배경',
    magnetic: '마그네틱',
    portal: '포털',
    shatter: '파편화',
    cursor: '커서',
    logo: '로고',
    outro: '아웃트로',
    money: '머니',
    counter: '카운터',
    hype: '하이프',
    reveal: '리빌',
    minimal: '미니멀',
    overlay: '오버레이',
    stack: '스택',
    tiktok: '틱톡',
    karaoke: '노래방',
    talking: '토킹',
    head: '헤드',
    website: '웹사이트',
    adaptation: '각색',
    water: '물',
    thunder: '번개',
    breathing: '호흡',
    london: '런던',
    chic: '시크',
    scan: '스캔',
    supercar: '슈퍼카',
    narrative: '내러티브',
    tropical: '트로피컬',
    beverage: '음료',
    magical: '마법',
    academy: '아카데미',
    meteor: '운석',
    tsunami: '쓰나미',
    disaster: '재난',
    chef: '셰프',
    kitchen: '주방',
    chaos: '혼돈',
    rural: '시골',
    aesthetics: '미학',
    healing: '힐링',
    short: '숏폼',
    film: '필름',
    monster: '몬스터',
    energy: '에너지',
    industrial: '산업',
    night: '밤',
    flashlight: '손전등',
    attack: '공격',
    pov: '시점',
    nightclub: '나이트클럽',
    flyer: '플라이어',
    atmospheric: '분위기',
    olympic: '올림픽',
    diver: '다이버',
    dynamic: '다이내믹',
    hk: '홍콩',
    wuxia: '무협',
    robot: '로봇',
    basketball: '농구',
    slam: '슬램',
    dunk: '덩크',
    romance: '로맨스',
    rapper: '래퍼',
    movement: '움직임',
    instruction: '지시',
    surf: '서핑',
    soul: '영혼',
    switching: '전환',
    magic: '마법',
    tactical: '전술',
    agent: '에이전트',
    combat: '전투',
    toaster: '토스터',
    rocket: '로켓',
    jumpscare: '점프스케어',
    traditional: '전통',
    performance: '공연',
    newspaper: '신문',
    courier: '배달원',
    lifestyle: '라이프스타일',
    viral: '바이럴',
    k: 'K',
    pop: '팝',
    survival: '서바이벌',
    match: '매치',
    cut: '컷',
    wasteland: '황무지',
    factory: '공장',
    chase: '추격',
  };
  const translated = value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .split(/\s+/)
    .map((token) => tokenMap[token] ?? (/^[가-힣]+$/.test(token) ? token : ''))
    .filter(Boolean);
  return translated.length > 0 ? dedupeAdjacent(translated).join(' ') : '창작 템플릿';
}

function dedupeAdjacent(parts: string[]): string[] {
  return parts.filter((part, idx) => idx === 0 || part !== parts[idx - 1]);
}
