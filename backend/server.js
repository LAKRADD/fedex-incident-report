const express = require('express');
const cors = require('cors');

const app = express();

/* 🔓 Autorise ton frontend Vercel */
app.use(cors({
  origin: 'https://fedex-incident-report-76s7.vercel.app'
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;

/* 🔐 ON MET LA CLÉ DIRECTEMENT (temporaire) */
const MAXIMO_API_KEY = 'mu23r5fahh0sbaqlpiahts79ovaqk0908duivbup';

/* ============================= */
/* 📦 ROUTE API WO              */
/* ============================= */

app.get('/api/wo/:wonum', async (req, res) => {
  const wonum = req.params.wonum.toUpperCase();

  const base =
    'https://main.manage.fxe-eu.suite.maximo.com/maximo/api/os/mxwo';

  const selectParam = [
    'WONUM','STATUS','DESCRIPTION','REPORTDATE',
    'ACTSTART','ACTFINISH','LOCATION.LOCATION','ASSET.ASSETTAG',
    'FAILURECODE','FDXROLLOVERIMPACT','FDXRCAINCIDENTTYP',
    'FDXRCAINCTIMELDESC_LONGDESCRIPTION',
    'FDXRCAANALYSMET_LONGDESCRIPTION',
    'FDXRCAROOTCAUSE_LONGDESCRIPTION',
    'REL.MODDOWNTIMEHIST{DOWNTIME}'
  ].join(',');

  const where = encodeURIComponent(
    `WOCLASS="WORKORDER" and WONUM="${wonum}"`
  );

  const target =
    `${base}?apikey=${MAXIMO_API_KEY}` +
    `&oslc.select=${selectParam}` +
    `&oslc.pageSize=1&lean=1&ignorekeyref=1` +
    `&ignorers=1&ignorecollectionref=1` +
    `&oslc.where=${where}`;

  try {
    const response = await fetch(target);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: `Maximo ${response.status}`,
        details: text
      });
    }

    const data = await response.json();

    if (!data.member?.length) {
      return res.json({ notFound: true });
    }

    const wo = data.member[0];

    res.json({
      wonum: wo.wonum,
      status: wo.status,
      description: wo.description,
      reportdate: wo.reportdate,
      actstart: wo.actstart,
      actfinish: wo.actfinish,
      failurecode: wo.failurecode,
      location: wo.location,
      asset: wo.asset,
      moddowntimehist: wo.moddowntimehist || [],
      incidentType: wo.fdxrcaincidenttyp,
      incidentTimeline: wo.fdxrcainctimeldesc_longdescription,
      fiveWhy: wo.fdxrcaanalysmet_longdescription,
      rootCause: wo.fdxrcarootcause_longdescription,
      impactOPS: wo.fdxrolloverimpact
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
});
