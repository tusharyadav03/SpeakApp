require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || '292dbe5a65bfc136b1304ade415f8e79034e8a0872bc4f32c0fa0547564147b1bc90993151359a236d16d8bf2cd3d7a1ae8965ac0d49a41386811c91321bebbb';
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET not set in env — using built-in fallback. Set JWT_SECRET in production!');
// Try 'dist_out' first (new), then 'dist' (legacy) for backwards compat
const CLIENT_DIST = fs.existsSync(path.join(__dirname, 'client', 'dist_out'))
  ? path.join(__dirname, 'client', 'dist_out')
  : path.join(__dirname, 'client', 'dist');
const ROOM_STALE_MS = 2 * 60 * 60 * 1000; // 2h — auto-cleanup stale rooms

// ─── Database (in-memory) ────────────────────────────────────────────────────
const users = new Map();
let userIdCounter = 0; // monotonic ID — never reuse
const events = [];
const rooms = new Map();
// socketId → { roomId, role, userId (for attendees) } — fast lookup on disconnect/reconnect
const socketMeta = new Map();

// ─── Profanity Filter (comprehensive multi-language) ────────────────────────
// Uses naughty-words package (28 languages, 2400+ words) + manual additions
const naughtyWords = require('naughty-words');
const PROFANITY = new Set();

// Load all languages from naughty-words package
Object.values(naughtyWords).forEach(list => {
  if (Array.isArray(list)) list.forEach(w => { if (w && w.length >= 2) PROFANITY.add(w.toLowerCase().trim()); });
});

// Add European languages missing from the package + English derivatives
const extraWords = [
  // English derivatives the package misses
  'fucker','fuckers','fucked','fucks','fuking','fking','fck','fuk','stfu','gtfo','lmfao',
  'shithead','shitface','shithole','shitstain','bullshitter','dipshit','horseshit','apeshit',
  'asshat','asswipe','buttfuck','clusterfuck','mindfuck','skullfuck',
  'cocksucker','dickhead','dickwad','douchebag','douche',
  'boner','blowjob','handjob','rimjob','circlejerk',
  'whoring','slutty','slutbag',
  'bitchy','bitches','bitching','sonofabitch',
  'nigga','niggas','nigg3r','n1gger','n1gga',
  'retard','retarded',

  // ═══ Romanian (ro) - COMPREHENSIVE ═══
  'pula','pulă','pizda','pizdă','fut','futut','futu-ți','fututi','futai','muie','muist',
  'căcat','cacat','rahat','cur','curva','curvă','curvistina','coaie','coaiele',
  'bulangiu','labagiu','sugipula','dracului','drace','prostituată','prostituata',
  'nenorocit','nenorocită','nenorocita','poponar','bou','idiot','imbecil','cretin',
  'tarfa','tâmpit','tampit','fraier','pizdulice','pularau','mamă-ta','mama-ta',
  'morții tăi','mortii tai','morții mă-tii','suge-o','sugeo','du-te dracu',
  'pizda mă-tii','bagă-mi-aș','bagamias','futu-ți morții','căcăcios','cacacios',
  'pizdos','pulangiu','scârbos','scarbos','împuțit','imputit','gunoi',
  'jigodie','javră','javra','lichea','mizerabil','nenoroc','laba','labă',

  // ═══ Greek (el) - COMPREHENSIVE ═══
  'γαμώ','γαμω','γαμήσου','γαμησου','γαμημένε','γαμημενε','γαμημένο','γαμημενο',
  'μαλάκα','μαλακα','μαλάκας','μαλακας','μαλακία','μαλακια','μαλακισμένος','μαλακισμενος',
  'πούτσα','πουτσα','πούτσο','πουτσο','πουτάνα','πουτανα','πουτανιό','πουτανιο',
  'σκατά','σκατα','σκατό','σκατο','σκατοφάτσα','σκατοφατσα','σκατόψυχος','σκατοψυχος',
  'αρχίδι','αρχιδι','αρχίδια','αρχιδια','αρχιδάτος','αρχιδατος',
  'μουνί','μουνι','μουνιά','μουνια','μουνόπανο','μουνοπανο',
  'καριόλα','καριολα','καριόλης','καριολης','καθίκι','καθικι',
  'βρωμιάρα','βρωμιαρα','βρωμιάρης','βρωμιαρης','πούστη','πουστη',
  'πούστης','πουστης','κωλοτρυπίδα','κωλοτρυπιδα','κωλοβάρα','κωλοβαρα',
  'κωλαράκος','κωλαρακος','πιπόνι','πιπονι','πιπίνι','πιπινι',
  'βύζια','βυζια','βυζάρα','βυζαρα','πρωκτός','πρωκτος',
  'gamo','malaka','poutana','skata','arhidi','mouni','kariola','pousti',
  'gamiso','gamimene','mounopano','skatomouni','gamisou',

  // ═══ Bulgarian (bg) - COMPREHENSIVE ═══
  'еба','ебал','ебаще','ебати','ебаняк','ебах','ебеш',
  'путка','путки','курва','курви','шибан','шибана','шибано','шибаняк',
  'мамка','мамкаму','мамкати','майната','майнатати',
  'педал','педали','педераст','педерас','гъз','газ',
  'лайно','лайна','лайнар','лайняк','дупе','дупка','дупета',
  'копеле','копелдак','простак','простачка','глупак','идиот',
  'пикая','пикаеш','пикня','лайнарка','куче','кучка',
  'мърша','мръсница','мършав','мазник','мазна',
  'боклук','боклуци','смрад','смрадлив','смрадливец',

  // ═══ Croatian / Serbian / Bosnian (hr) - COMPREHENSIVE ═══
  'jebem','jebati','jebiga','jebote','jebanje','jebo','jebala','jebač','jebac',
  'kurac','kurčina','kurcina','kurceva','pička','picka','pičkica','pickica',
  'sranje','srat','sranje','srao','usrao','posrao','usrana',
  'kurva','kurve','kurvanje','kurvetina','govno','govnar','govnarija','govnara',
  'drolja','šljiva','sljiva','šupak','supak','šupčina','supcina',
  'seljačino','seljacino','kreten','kretenu','idiot','budala','budalo',
  'mamicu ti','majku ti','jebem ti majku','jebem ti mater',
  'pizda','pizdek','pizdun','pizdunjara',
  'fukara','šonja','sonja','debil','debilu','glupan','glupane',
  'konjino','konju','magarac','magarče','smeće','smece',

  // ═══ Slovak (sk) - COMPREHENSIVE ═══
  'kurva','kurvy','kurvin','jebať','jebat','jebem','jebnutý','jebnuty',
  'piča','pica','pičoviny','picoviny','kokot','kokotina','kokoti',
  'čurák','curak','čurina','curina','hovno','hovná','hovna','hovnivál','hovnival',
  'sráč','srac','srať','srat','zasraný','zasrany','posrať','posrat',
  'debil','debilný','debilny','kretén','kreten','idiot','blbec','blb',
  'hajzel','hajzlík','hajzlik','dement','dementi',
  'mrdať','mrdat','mrdka','zmrd','zmrdi','zmrdovi',
  'šľapka','slapka','štetka','stetka','kurvik','pobehlica',
  'prasa','prašivý','prasivy','hovädina','hovadina',

  // ═══ Slovenian (sl) - COMPREHENSIVE ═══
  'kurba','kurbe','kurac','kurec','jebati','jebem','jebiga',
  'pizda','pizdek','pizdun','sranje','srat','usrat','zasran',
  'drek','dreka','drekov','fukati','fuka','pofukana','pofukan',
  'zajebi','zajebavat','zajebancija','mater','v materino','mamina',
  'prasica','prasec','svinja','kreten','idiot','debil',
  'peder','pedercek','kurvin','kurbin','skurjen',
  'govnar','govno','dristati','dristje','smrad','smrdljiv',
  'tepec','bedak','bedakov','butec','butelj',

  // ═══ Estonian (et) - COMPREHENSIVE ═══
  'kurat','krt','kuradi','kuradima','kuratlik',
  'türa','tura','türapea','turapea','türanahk','turanahk',
  'perse','perses','persse','persevest','perseauk',
  'munn','munni','munnike','keps','kepsti','kepime',
  'jobu','jobukas','nussima','nussida','nussi',
  'lits','litsi','litslik','hoor','hooratama',
  'sitt','sitta','sittunud','pask','paska','paskane',
  'raisk','raisapea','kuu','kuuse','loll','lollike',
  'tölp','tolp','idioot','debiilik','debiil',
  'nõme','nome','tibla','kretiin','kretiinlik',

  // ═══ Latvian (lv) - COMPREHENSIVE ═══
  'dirsā','dirsa','dirsai','dirsēt','dirset','dirsāt','dirsat',
  'pīzda','pizda','pīzdec','pizdec','pīzdīt','pizdit','pīzdiens','pizdiens',
  'sūdā','suda','sūds','suds','sasūdīt','sasudit',
  'kuce','kuces','kucēns','kucens','kuča','kuca',
  'pidars','pidari','pidarasts','pidarast','pidarass',
  'mauka','maukas','mauka','maukošana','maukosana',
  'dirst','dirsties','piedirst','piedirsi',
  'draņķis','drankis','draņķīgs','drankigs',
  'muļķis','mulkis','debīls','debils','idiots',
  'pakaļa','pakala','pakaļā','pakala',
  'pists','pistā','pista','pisties','izpist',

  // ═══ Lithuanian (lt) - COMPREHENSIVE ═══
  'šūdas','sudas','šūdo','sudo','šūdžius','sudzius','šūdinus','sudinus',
  'bybys','bybio','bybi','bybipalaikis',
  'kalė','kale','kalės','kales','kalyt','kalyte',
  'pyzda','pyzdos','pyzdec','pyzdalūpis','pyzdalupis',
  'rupūžė','rupuze','rupūžės','rupuzes',
  'subinė','subine','subines','subinės','subinėn','subinen',
  'pist','pisti','nupist','nupisti','papist','papisti',
  'nusimaut','mautyti','maut','nusimautyti',
  'krūtys','krutys','krūtines','krutines',
  'debil','debile','debilu','debilai',
  'kekšė','kekse','paleistuvė','paleistuve','paleistuvis',
  'šikna','sikna','šiknas','siknas','šiknasparys','siknasparys',
  'blet','blemba','blyn',

  // ═══ Ukrainian (uk) - COMPREHENSIVE ═══
  'блядь','бляді','блядськи','бляха','бляхамуха',
  'хуй','хуя','хує','хуєсос','хуїв','хуйня','хуйло',
  'курва','курви','курвин','курвисько',
  'сука','суки','сучка','сучий','сучара',
  'залупа','залупний','залупитись',
  'дрочити','дрочила','дрочун',
  'їбати','їбаний','їбанько','їбать','їбальник',
  'пизда','піздюк','піздец','піздити','піздюлі',
  'мудак','мудила','мудозвін','мудозвон',
  'сраний','сранка','сратися','засранець','засранка',
  'лайно','гівно','гівнюк','гівняк',
  'дупа','жопа','жопний','жопастий',
  'підар','підарас','підарасина',
  'падлюка','потвора','виродок','покидьок',

  // ═══ Luxembourgish (lb) - COMPREHENSIVE ═══
  'schäissdrek','schäiss','scheiss','dreck','drecksau','dreckig',
  'leck','leck mech','lecken','houermamm','houer','houerkand',
  'arschlach','arschloch','aaschlach','vollidiott','idiot',
  'fotze','fotz','kackbratze','kack','kacken',
  'wichser','wichsen','hurensohn','huresohn',
  'fick','ficken','gefickt','fickdech','fickdechen',
  'schwéng','schwanz','piss','pissen','angepisst',
  'depp','dummkapp','neisel','schnull','schnëssen',
  'mëscht','mischt','stronz','kutz','kutzig',

  // ═══ Missing words from package verification ═══
  // Spanish
  'joder','jodido','jodidos','jódete','jodete','coger','chingada','chingado','verga','vergón','vergon',
  // Dutch
  'kanker','kankeren','kankerlijer','tyfuslijer','teringlijer','pokkelijer',
  // Swedish
  'jävla','jävlar','jävel','skit','skita','skitsnack','hora','horor','horunge','kuksugare','fittkärring',
  // Danish
  'fanden','for fanden','pisse','luder','røvhul','kraftidiot',
  // Finnish
  'saatana','saatanan','jumalauta','helvetti','paskahousu','mulkku','pillu','huora',
  // Czech
  'píča','pičus','zmrd','vole','hajzl','kurváhoř','zkurvenej','zasranej',
  // Hungarian
  'baszd','baszni','baszás','baszmeg','baszódj','bazdmeg','gecis','szaros','fasszopó',
  // Turkish
  'amına','amina','amk','amcık','amcik','yarrak','yarrağ','yarram','yarramı','orosbuçocuğu','ibne','götveren',
  // French additional
  'putain de mère','fils de pute','va te faire foutre','nique ta mère','ta gueule',
  // German additional  
  'scheiß','scheiss','verdammt','verfickt','wichse','schwuchtel','missgeburt',
].map(w => w.toLowerCase().trim());

extraWords.forEach(w => { if (w.length >= 2) PROFANITY.add(w); });

console.log(`🚫 Profanity filter loaded: ${PROFANITY.size} words across 40+ languages`);

// Common compound patterns: "[word] fucker", "[word] shit", etc.
const PROFANITY_SUFFIXES = ['fucker','fucking','shit','shitting','ass','hole','sucker','head','face','bag','wipe','tard'];
const PROFANITY_PREFIXES = ['mother','sister','brother','father','bull','horse','dumb','jack','smart','dog','rat','butt','shit','ass','cock'];

// Safe words that should NEVER be filtered (common false positives)
const SAFELIST = new Set([
  // Common short English words (false positives from multilingual profanity lists)
  'am','an','con','fan','pot','dam',
  'ashley','ass','assume','assault','assemble','assembly','assert','assertion','assess','assessment',
  'asset','assets','assign','assignment','assist','assistant','associate','association',
  'class','classic','classical','classification','classified','classify','classroom',
  'brass','grass','glass','mass','massive','pass','passage','passenger','passing','passion','passionate',
  'compass','embarrass','embassy','harass','harassment',
  'bass','bassoon','ambassador',
  'cocktail','cockpit','cockatoo','peacock','hancock','woodcock',
  'scunthorpe','sussex','essex','middlesex',
  'therapist','analyst','organism','title','button','document',
  'dick','dickens','dickson','dictionary',
  'beaver','dam','hell','hello','damn','dammit',
  'piss','pistol','piston','piste',
  'shitake','shiitake',
  'condom','condolence','condition','conduct','conference','confide','confident',
  'country','count','counter','counsel','county',
  'custom','customer','custody',
  'execute','execution','executive',
  'homosexual','bisexual','sexual','sexuality',
  'analysis','analyst','analyze',
  'angina','regina','vagina',
  'arsenal','semen','semester','seminar','penthouse','penalty','penetrate',
  'cumulative','accumulate','cucumber','document','circumstance',
  'happiness','happiest','therapist',
  'bigger','digger','trigger','snigger', // keep the safe compound-suffix versions
  'putter','butter','gutter','cutter','mutter','nutter','stutter','sputter','clutter','flutter','shutter','utter',
  'hooker', // surname
  'con','concern','concept','conclude','conclusion','concrete','consent','consider','consist','constant',
  'fan','fancy','fantastic','fantasy','fandom',
  'sex','sexist','sexism',
  'hoe','hoer','shoe','shoer',
  'tit','title','titan','titanium',
  'pik','pike','spike',
  'kuk','kuku','kukui',
  'lul','lull','lullaby',
]);

function filterProfanity(text) {
  let beeped = false;
  
  // STEP 1: Check multi-word phrases first (e.g. "hijo de puta", "son of a bitch")
  let result = text;
  const lowerFull = text.toLowerCase();
  for (const phrase of PROFANITY) {
    if (phrase.includes(' ') && lowerFull.includes(phrase)) {
      beeped = true;
      const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      result = result.replace(regex, (m) => m[0] + '*'.repeat(m.length - 1));
    }
  }
  
  // STEP 2: Check individual words
  const tokens = result.split(/(\s+)/);
  const filtered = tokens.map(word => {
    if (!word.trim()) return word; // whitespace
    
    const clean = word.toLowerCase().replace(/[.,!?;:'"()\-_!@#$%^&*]/g, '');
    if (clean.length < 2) return word;
    
    // Skip safe words
    if (SAFELIST.has(clean)) return word;
    
    // Exact match
    if (PROFANITY.has(clean)) {
      beeped = true;
      const punct = word.match(/[.,!?;:'"()\-_!@#$%^&*]+$/)?.[0] || '';
      const core = word.slice(0, word.length - punct.length);
      return core[0] + '*'.repeat(Math.max(core.length - 1, 1)) + punct;
    }
    
    // Compound check: "motherfucker", "sisterfucker", "bullshit" etc.
    const lower = clean;
    for (const suffix of PROFANITY_SUFFIXES) {
      if (lower.endsWith(suffix) && lower.length > suffix.length) {
        const prefix = lower.slice(0, lower.length - suffix.length);
        if (PROFANITY_PREFIXES.includes(prefix) || PROFANITY.has(prefix)) {
          beeped = true;
          const punct = word.match(/[.,!?;:'"()\-_!@#$%^&*]+$/)?.[0] || '';
          const core = word.slice(0, word.length - punct.length);
          return core[0] + '*'.repeat(Math.max(core.length - 1, 1)) + punct;
        }
      }
    }
    for (const prefix of PROFANITY_PREFIXES) {
      if (lower.startsWith(prefix) && PROFANITY.has(lower.slice(prefix.length))) {
        beeped = true;
        const punct = word.match(/[.,!?;:'"()\-_!@#$%^&*]+$/)?.[0] || '';
        const core = word.slice(0, word.length - punct.length);
        return core[0] + '*'.repeat(Math.max(core.length - 1, 1)) + punct;
        }
    }
    
    return word;
  }).join('');
  
  // STEP 3: Check two-word combos like "mother fucker", "son of bitch"
  let finalResult = filtered;
  const wordList = text.toLowerCase().split(/\s+/);
  for (let i = 0; i < wordList.length - 1; i++) {
    const combo = wordList[i] + wordList[i + 1];
    if (PROFANITY.has(combo)) {
      beeped = true;
      const regex = new RegExp(`(${wordList[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(\\s+)(${wordList[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      finalResult = finalResult.replace(regex, (m, w1, space, w2) => w1[0] + '*'.repeat(w1.length - 1) + space + w2[0] + '*'.repeat(w2.length - 1));
    }
  }

  return { text: finalResult, beeped };
}

async function seedAdmin() {
  const hash = await bcrypt.hash('admin123', 10);
  const adminId = ++userIdCounter;
  users.set('admin@speakapp.io', {
    id: adminId, email: 'admin@speakapp.io', password_hash: hash,
    name: 'Admin', role: 'superadmin'
  });
  console.log('✅ Admin ready: admin@speakapp.io / admin123');
}

// ─── Room helpers ────────────────────────────────────────────────────────────
function makeCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += c[Math.floor(Math.random() * c.length)];
  return code;
}

function getRoom(id) { return id ? rooms.get(id.toUpperCase()) : null; }

function roomJSON(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, hostName: r.hostName, status: r.status,
    queue: r.queue.map(q => ({ id: q.id, name: q.name, question: q.question || '', linkedin: q.linkedin || '' })),
    currentSpeaker: r.currentSpeaker ? { id: r.currentSpeaker.id, name: r.currentSpeaker.name, question: r.currentSpeaker.question || '', linkedin: r.currentSpeaker.linkedin || '' } : null,
    attendeeCount: r.attendees.size,
    transcript: r.transcript.slice(-50)
  };
}

// ─── Express ─────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Serve built frontend
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  console.log('📁 Serving frontend from:', CLIENT_DIST);
}

// ─── Socket.IO ───────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 15000,
  maxHttpBufferSize: 1e6, // 1MB max message
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 min recovery window
    skipMiddlewares: true,
  },
});

// ─── Stale room cleanup (every 30 min) ──────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.status === 'ended' || (now - room.createdAt > ROOM_STALE_MS && room.attendees.size === 0)) {
      rooms.delete(code);
      console.log(`🧹 Cleaned stale room ${code}`);
    }
  }
}, 30 * 60 * 1000);

// ─── Auth helpers ────────────────────────────────────────────────────────────
function authMiddleware(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.split(' ')[1], JWT_SECRET); } catch { return null; }
}

// ─── REST API ────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, users: users.size, uptime: Math.floor(process.uptime()) });
});

// Translation proxy (avoids CORS issues with Google Translate)
app.post('/api/translate', async (req, res) => {
  try {
    const { text, target } = req.body;
    if (!text || !target) return res.status(400).json({ error: 'text and target required' });
    
    const tl = target === 'no' ? 'no' : target === 'lb' ? 'de' : target;
    
    // Try Google Translate first (best quality)
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(text.slice(0, 1000))}`;
      const gRes = await fetch(url);
      if (gRes.ok) {
        const d = await gRes.json();
        if (d && d[0]) {
          const translated = d[0].map(s => s[0]).join('');
          if (translated && translated.toLowerCase() !== text.toLowerCase()) {
            return res.json({ translated, source: 'google' });
          }
        }
      }
    } catch (e) { console.log('Google translate failed:', e.message); }

    // Fallback: MyMemory
    try {
      const mmTl = target === 'no' ? 'nb' : target === 'lb' ? 'de' : target;
      const mmRes = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=en|${mmTl}&de=speakapp@conference.io`);
      if (mmRes.ok) {
        const d = await mmRes.json();
        const result = d.responseData?.translatedText;
        if (result && !result.includes('MYMEMORY WARNING') && result.toLowerCase() !== text.toLowerCase()) {
          return res.json({ translated: result, source: 'mymemory' });
        }
      }
    } catch (e) { console.log('MyMemory failed:', e.message); }

    // All failed
    res.json({ translated: text, source: 'none' });
  } catch (e) {
    console.error('Translation error:', e);
    res.json({ translated: req.body?.text || '', source: 'error' });
  }
});

// Translate original text and then apply profanity filter to the translation
app.post('/api/translate-filter', async (req, res) => {
  try {
    const { text, target } = req.body;
    if (!text || !target) return res.status(400).json({ error: 'text and target required' });
    
    const tl = target === 'no' ? 'no' : target === 'lb' ? 'de' : target;
    let translated = text;
    
    // Try Google Translate first
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(text.slice(0, 1000))}`;
      const gRes = await fetch(url);
      if (gRes.ok) {
        const d = await gRes.json();
        if (d && d[0]) {
          const t = d[0].map(s => s[0]).join('');
          if (t && t.toLowerCase() !== text.toLowerCase()) translated = t;
        }
      }
    } catch (e) { console.log('Google translate failed:', e.message); }
    
    // If Google failed, try MyMemory
    if (translated === text) {
      try {
        const mmTl = target === 'no' ? 'nb' : target === 'lb' ? 'de' : target;
        const mmRes = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=en|${mmTl}&de=speakapp@conference.io`);
        if (mmRes.ok) {
          const d = await mmRes.json();
          const result = d.responseData?.translatedText;
          if (result && !result.includes('MYMEMORY WARNING') && result.toLowerCase() !== text.toLowerCase()) {
            translated = result;
          }
        }
      } catch (e) { console.log('MyMemory failed:', e.message); }
    }
    
    // Apply profanity filter to the translated text
    const { text: filtered, beeped } = filterProfanity(translated);
    res.json({ translated: filtered, beeped, source: 'filtered' });
  } catch (e) {
    console.error('Translate-filter error:', e);
    res.json({ translated: req.body?.text || '', beeped: false, source: 'error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = users.get(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const key = email.toLowerCase().trim();
    if (users.has(key)) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const user = { id: ++userIdCounter, email: key, password_hash: hash, name: name.trim(), role: 'user' };
    users.set(key, user);

    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const decoded = authMiddleware(req);
  if (!decoded) return res.status(401).json({ error: 'Not authenticated' });

  for (const u of users.values()) {
    if (u.id === decoded.userId) {
      return res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
    }
  }
  res.status(404).json({ error: 'User not found' });
});

app.get('/api/admin/stats', (req, res) => {
  const decoded = authMiddleware(req);
  if (!decoded) return res.status(401).json({ error: 'Not authenticated' });
  if (!['admin', 'superadmin'].includes(decoded.role)) return res.status(403).json({ error: 'Admin only' });

  res.json({ totalUsers: users.size, totalEvents: events.length, activeEvents: rooms.size });
});

// ─── Socket.IO handlers ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 +${socket.id.slice(0, 8)}`);

  socket.on('create_event', (data) => {
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();

    const room = {
      id: code, name: data?.name || 'Untitled', hostSocketId: socket.id,
      hostName: data?.hostName || 'Host', status: 'active',
      queue: [], currentSpeaker: null, attendees: new Map(), transcript: [],
      speakerSRActive: false, createdAt: Date.now(),
    };
    rooms.set(code, room);
    events.push({ code, name: room.name, host: room.hostName, ts: new Date() });

    socket.join(code);
    socket.roomId = code;
    socket.isHost = true;
    socketMeta.set(socket.id, { roomId: code, role: 'host' });
    socket.emit('event_created', roomJSON(room));
    console.log(`✅ Event ${code}: "${room.name}"`);
  });

  socket.on('end_event', (roomId) => {
    const room = getRoom(roomId);
    if (!room || socket.id !== room.hostSocketId) return;
    room.status = 'ended';
    io.to(room.id).emit('event_ended', { roomId: room.id });
    // Clean up all socket metadata for this room
    for (const [sid, meta] of socketMeta) {
      if (meta.roomId === room.id) socketMeta.delete(sid);
    }
    setTimeout(() => rooms.delete(room.id), 5000);
  });

  socket.on('join_room_attendee', ({ roomId, user }) => {
    const room = getRoom(roomId);
    if (!room) return socket.emit('error', 'Room not found. Check the code.');
    if (room.status === 'ended') return socket.emit('error', 'This event has ended');

    const userName = user?.name || 'Guest';
    const userLinkedin = user?.linkedin || '';
    room.attendees.set(socket.id, { id: socket.id, name: userName, linkedin: userLinkedin });
    socket.join(room.id);
    socket.roomId = room.id;
    socket.isHost = false;
    socketMeta.set(socket.id, { roomId: room.id, role: 'attendee', userName, userLinkedin });

    socket.emit('room_data', roomJSON(room));
    io.to(room.hostSocketId).emit('attendee_joined', { name: userName, count: room.attendees.size });
    console.log(`👤 ${userName} → ${room.id}`);
  });

  // Host reconnection — re-claim host seat if socket changed
  socket.on('host_rejoin', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room || room.status === 'ended') return socket.emit('error', 'Room not found or ended');
    // Cancel grace period timer
    if (room._hostGraceTimer) { clearTimeout(room._hostGraceTimer); room._hostGraceTimer = null; }
    room._hostDisconnectedAt = null;
    // Update host socket
    room.hostSocketId = socket.id;
    socket.join(room.id);
    socket.roomId = room.id;
    socket.isHost = true;
    socketMeta.set(socket.id, { roomId: room.id, role: 'host' });
    socket.emit('room_data', roomJSON(room));
    // Re-send transcript history
    room.transcript.slice(-50).forEach(e => socket.emit('transcript_update', e));
    // Notify attendees host is back
    io.to(room.id).emit('host_reconnected');
    console.log(`🔄 Host rejoined ${room.id}`);
  });

  // Presenter (projection display) — passive observer that joins the socket
  // room so it receives room_data / transcript_update broadcasts, but is NOT
  // counted as an attendee and cannot take the floor.
  socket.on('presenter_join', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) return socket.emit('error', 'Room not found for presenter.');
    if (room.status === 'ended') return socket.emit('error', 'This event has ended');
    socket.join(room.id);
    socket.isPresenter = true;
    socket.emit('room_data', roomJSON(room));
    console.log(`📺 Presenter display joined ${room.id}`);
  });

  socket.on('join_queue', ({ roomId, user }) => {
    const room = getRoom(roomId);
    if (!room || room.queue.some(q => q.id === socket.id)) return;
    const attendee = room.attendees.get(socket.id);
    room.queue.push({ id: socket.id, name: user?.name || 'Guest', question: '', linkedin: attendee?.linkedin || user?.linkedin || '' });
    io.to(room.id).emit('room_data', roomJSON(room));
  });

  socket.on('leave_queue', (roomId) => {
    const room = getRoom(roomId);
    if (!room) return;
    room.queue = room.queue.filter(q => q.id !== socket.id);
    io.to(room.id).emit('room_data', roomJSON(room));
  });

  socket.on('submit_question', ({ roomId, text }) => {
    const room = getRoom(roomId);
    if (!room) return;
    const entry = room.queue.find(q => q.id === socket.id);
    if (entry) {
      // Apply profanity filter to submitted questions
      const { text: cleanText } = filterProfanity(text || '');
      entry.question = cleanText;
      io.to(room.id).emit('room_data', roomJSON(room));
    }
  });

  socket.on('grant_floor', ({ roomId, userId }) => {
    const room = getRoom(roomId);
    if (!room || room.currentSpeaker || socket.id !== room.hostSocketId) return;
    const idx = room.queue.findIndex(q => q.id === userId);
    if (idx < 0) return;
    room.currentSpeaker = room.queue.splice(idx, 1)[0];
    room.speakerSRActive = false; // reset for new speaker
    io.to(room.id).emit('room_data', roomJSON(room));
    io.to(userId).emit('floor_granted');
    io.to(room.hostSocketId).emit('speaker_sr_status', { active: false });
    console.log(`🎤 ${room.currentSpeaker.name} speaking in ${room.id}`);
  });

  socket.on('end_speech', (roomId) => {
    const room = getRoom(roomId);
    if (!room || !room.currentSpeaker) return;
    const speaker = room.currentSpeaker;
    room.currentSpeaker = null;
    room.speakerSRActive = false;
    io.to(room.hostSocketId).emit('speaker_sr_status', { active: false });
    io.to(room.id).emit('room_data', roomJSON(room));
    io.to(room.id).emit('speech_ended', { speakerName: speaker.name });
    // Notify the speaker they can request follow-up (re-join queue)
    io.to(speaker.id).emit('speech_done_can_rejoin');
  });

  socket.on('rejoin_queue', ({ roomId, user }) => {
    const room = getRoom(roomId);
    if (!room || room.queue.some(q => q.id === socket.id)) return;
    const attendee = room.attendees.get(socket.id);
    room.queue.push({ id: socket.id, name: user?.name || 'Guest', question: '(Follow-up)', linkedin: attendee?.linkedin || '' });
    io.to(room.id).emit('room_data', roomJSON(room));
  });

  socket.on('remove_from_queue', ({ roomId, userId }) => {
    const room = getRoom(roomId);
    if (!room || socket.id !== room.hostSocketId) return;
    room.queue = room.queue.filter(q => q.id !== userId);
    io.to(userId).emit('removed_from_queue');
    io.to(room.id).emit('room_data', roomJSON(room));
  });

  socket.on('remove_speaker', (roomId) => {
    const room = getRoom(roomId);
    if (!room || socket.id !== room.hostSocketId || !room.currentSpeaker) return;
    const speakerId = room.currentSpeaker.id;
    const speakerName = room.currentSpeaker.name;
    room.currentSpeaker = null;
    room.speakerSRActive = false;
    io.to(room.hostSocketId).emit('speaker_sr_status', { active: false });
    io.to(speakerId).emit('speech_ended', { speakerName });
    io.to(speakerId).emit('removed_from_speaking');
    io.to(room.id).emit('room_data', roomJSON(room));
  });

  socket.on('signal_followup', (roomId) => {
    const room = getRoom(roomId);
    if (room?.currentSpeaker) {
      io.to(room.hostSocketId).emit('followup_signal', { speakerName: room.currentSpeaker.name });
    }
  });

  socket.on('followup_response', ({ roomId, approved }) => {
    const room = getRoom(roomId);
    if (!room?.currentSpeaker) return;
    if (approved) {
      io.to(room.currentSpeaker.id).emit('followup_approved');
    } else {
      const speaker = room.currentSpeaker;
      io.to(speaker.id).emit('followup_declined');
      room.currentSpeaker = null;
      // Re-add speaker to end of queue
      const attendee = room.attendees.get(speaker.id);
      room.queue.push({ id: speaker.id, name: speaker.name, question: '(Follow-up)', linkedin: attendee?.linkedin || speaker.linkedin || '' });
      io.to(room.id).emit('room_data', roomJSON(room));
    }
  });

  socket.on('send_reaction', ({ roomId, emoji }) => {
    if (roomId && emoji) io.to(roomId.toUpperCase()).emit('reaction_received', emoji);
  });

  // ─── WebRTC signaling (room-isolated P2P) ──────────────────
  // Offers always go attendee → host. Answers always go host → attendee.
  // ICE candidates are routed via explicit `to` field — never broadcast.
  socket.on('webrtc_offer', ({ roomId, offer }) => {
    const room = getRoom(roomId);
    if (!room) return console.warn(`⚠️ WebRTC offer for unknown room: ${roomId}`);
    // Verify sender is in this room
    if (!room.attendees.has(socket.id) && socket.id !== room.hostSocketId) return;
    console.log(`📡 Offer: ${socket.id.slice(0,6)} → host [${roomId}]`);
    io.to(room.hostSocketId).emit('webrtc_offer', { from: socket.id, offer, roomId: room.id });
  });

  socket.on('webrtc_answer', ({ to, answer, roomId }) => {
    if (!to) return;
    // Verify both parties are in the same room
    const room = getRoom(roomId);
    if (room && socket.id === room.hostSocketId) {
      console.log(`📡 Answer: host → ${to.slice(0,6)} [${roomId}]`);
      io.to(to).emit('webrtc_answer', { from: socket.id, answer });
    }
  });

  socket.on('webrtc_ice', ({ candidate, to, roomId }) => {
    if (!candidate) return;
    const room = getRoom(roomId);
    if (!room) return;
    const senderInRoom = socket.id === room.hostSocketId || room.attendees.has(socket.id);
    if (!senderInRoom) return;
    // If attendee sends with to=null, route to host automatically
    const target = to || (socket.id !== room.hostSocketId ? room.hostSocketId : null);
    if (!target) return;
    const targetInRoom = target === room.hostSocketId || room.attendees.has(target);
    if (targetInRoom) {
      io.to(target).emit('webrtc_ice', { from: socket.id, candidate });
    }
  });

  // WebRTC renegotiation — attendee requests new offer/answer cycle
  socket.on('webrtc_renegotiate', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room || !room.currentSpeaker || room.currentSpeaker.id !== socket.id) return;
    // Tell attendee to create a new offer
    io.to(socket.id).emit('webrtc_renegotiate_ack');
    console.log(`🔄 Renegotiation requested in ${roomId}`);
  });

  socket.on('transcript_update', ({ roomId, text, speaker }) => {
    const room = getRoom(roomId);
    if (!room) return;
    const entry = { id: Date.now(), speaker: speaker || room.currentSpeaker?.name || 'Speaker', text, timestamp: Date.now() };
    room.transcript.push(entry);
    if (room.transcript.length > 100) room.transcript = room.transcript.slice(-100);
    io.to(room.id).emit('transcript_update', entry);
  });

  // Guest signals their SpeechRecognition is active (so host mic is suppressed)
  socket.on('sr_active', ({ roomId, active }) => {
    const room = getRoom(roomId);
    if (!room) return;
    // Only the current speaker can set this flag
    if (room.currentSpeaker?.id === socket.id) {
      room.speakerSRActive = !!active;
      // Notify host so UI can update
      io.to(room.hostSocketId).emit('speaker_sr_status', { active: room.speakerSRActive });
      console.log(`🎙️ Speaker SR ${active ? 'ON' : 'OFF'} in ${roomId}`);
    }
  });

  // Speech-to-text from speaker's phone or host
  socket.on('transcript_send', ({ roomId, text, speaker }) => {
    const room = getRoom(roomId);
    if (!room || !text) return;

    // KEY FIX: If guest is self-transcribing, ignore host's mic transcripts
    // Guest's phone mic = clean source; host mic = degraded room audio
    const isHost = socket.id === room.hostSocketId;
    if (isHost && room.speakerSRActive && room.currentSpeaker) {
      // Host mic transcript ignored — guest is sending clean transcripts
      return;
    }

    // Filter profanity
    const { text: cleanText, beeped } = filterProfanity(text);
    if (beeped) console.log(`🚫 Profanity filtered [${roomId}]: "${text}" → "${cleanText}"`);
    else console.log(`📝 Transcript [${roomId}]: ${speaker}: ${text}`);

    const entry = {
      id: Date.now(),
      speaker: speaker || room.currentSpeaker?.name || 'Speaker',
      text: cleanText,
      originalText: beeped ? text : undefined, // send original for translation only if beeped
      beeped,
      timestamp: Date.now()
    };
    room.transcript.push(entry);
    if (room.transcript.length > 100) room.transcript = room.transcript.slice(-100);
    io.to(room.id).emit('transcript_update', entry);
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 -${socket.id.slice(0, 8)} (${reason})`);
    const meta = socketMeta.get(socket.id);
    socketMeta.delete(socket.id);

    const roomId = socket.roomId || meta?.roomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.isHost || meta?.role === 'host') {
      // Give host 30s grace period to reconnect before ending event
      room._hostDisconnectedAt = Date.now();
      io.to(room.id).emit('host_disconnected');
      console.log(`⏳ Host grace period started for ${room.id} (30s)`);
      room._hostGraceTimer = setTimeout(() => {
        // Check if host reconnected (hostSocketId would have changed)
        if (room._hostDisconnectedAt && room.status === 'active') {
          room.status = 'ended';
          io.to(room.id).emit('event_ended', { reason: 'Host disconnected' });
          for (const [sid, m] of socketMeta) {
            if (m.roomId === room.id) socketMeta.delete(sid);
          }
          setTimeout(() => rooms.delete(room.id), 5000);
          console.log(`❌ Host didn't return, ending ${room.id}`);
        }
      }, 30000);
    } else if (socket.isPresenter) {
      // Presenters just leave silently
    } else {
      room.attendees.delete(socket.id);
      room.queue = room.queue.filter(q => q.id !== socket.id);
      if (room.currentSpeaker?.id === socket.id) {
        const speakerName = room.currentSpeaker.name;
        room.currentSpeaker = null;
        room.speakerSRActive = false;
        io.to(room.hostSocketId).emit('speaker_sr_status', { active: false });
        io.to(room.id).emit('speech_ended', { speakerName });
      }
      io.to(room.id).emit('room_data', roomJSON(room));
    }
  });
});

// ─── SPA fallback (must be AFTER /api routes) ────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const index = path.join(CLIENT_DIST, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(200).send('<h1>SpeakApp</h1><p>Frontend not built. Run: <code>npm run build</code></p>');
});

// ─── Start ───────────────────────────────────────────────────────────────────
seedAdmin().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎤 SpeakApp running on port ${PORT}\n`);
  });
});
