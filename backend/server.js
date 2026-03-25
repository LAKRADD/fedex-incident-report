const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();

/* ── CORS complet pour Vercel ── */
app.use(cors({
  origin: 'https://fedex-incident-report-76s7.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Répondre aux preflight OPTIONS envoyés par le navigateur
app.options('*', cors());

app.use(express.json());

const PORT           = process.env.PORT || 3000;
const MAXIMO_API_KEY = process.env.MAXIMO_API_KEY;

if (!MAXIMO_API_KEY) {
  console.error('❌  MAXIMO_API_KEY manquante — ajoutez-la dans les variables Railway.');
  process.exit(1);
}

const WO_RE = /^[A-Z0-9\-]{1,20}$/;

app.get('/api/wo/:wonum', async (req, res) => {
  const wonum = req.params.wonum.toUpperCase();

  if (!WO_RE.test(wonum)) {
    return res.status(400).json({ error: 'Format de WO invalide.' });
  }

  const base = 'https://main.manage.fxe-eu.suite.maximo.com/maximo/api/os/mxwo';

  const selectParam = [
    'WONUM', 'STATUS', 'DESCRIPTION', 'REPORTDATE',
    'ACTSTART', 'ACTFINISH', 'LOCATION.LOCATION', 'ASSET.ASSETTAG',
    'FAILURECODE', 'FDXROLLOVERIMPACT', 'FDXRCAINCIDENTTYP',
    'FDXRCAINCTIMELDESC_LONGDESCRIPTION', 'FDXRCAANALYSMET_LONGDESCRIPTION',
    'FDXRCAROOTCAUSE_LONGDESCRIPTION', 'REL.MODDOWNTIMEHIST{DOWNTIME}',
  ].join(',');

  const where = encodeURIComponent(`WOCLASS="WORKORDER" and WONUM="${wonum}"`);

  const target =
    `${base}?apikey=${MAXIMO_API_KEY}` +
    `&oslc.select=${selectParam}` +
    `&oslc.pageSize=1&lean=1&ignorekeyref=1&ignorers=1&ignorecollectionref=1` +
    `&oslc.where=${where}`;

  console.log('→ GET WO:', wonum);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(target, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      console.error('Maximo error:', text);
      return res.status(response.status).json({ error: `Maximo ${response.status}`, details: text });
    }

    const data = await response.json();

    if (!data.member || !data.member.length) {
      return res.json({ notFound: true });
    }

    const wo = data.member[0];

    res.json({
      wonum:            wo.wonum,
      status:           wo.status,
      description:      wo.description,
      reportdate:       wo.reportdate,
      actstart:         wo.actstart,
      actfinish:        wo.actfinish,
      failurecode:      wo.failurecode,
      location:         wo.location,
      asset:            wo.asset,
      moddowntimehist:  wo.moddowntimehist || [],
      incidentType:     wo.fdxrcaincidenttyp,
      incidentTimeline: wo.fdxrcainctimeldesc_longdescription,
      fiveWhy:          wo.fdxrcaanalysmet_longdescription,
      rootCause:        wo.fdxrcarootcause_longdescription,
      impactOPS:        wo.fdxrolloverimpact,
    });

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout Maximo (10s).' });
    }
    console.error('Erreur serveur:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅  API → http://localhost:${PORT}`));
