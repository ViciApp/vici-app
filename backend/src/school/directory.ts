// University directory backing the school-email domain gate: the server-side
// twin of the app's Worlds picker roster, slimmed to the four fields the
// email matcher consumes (id, name, country, verified domains). Additions are
// append-only; ids are the canonical affiliation identifiers stored on
// verified rows.

export interface SchoolDirectoryEntry {
	id: string;
	name: string;
	country: string | null;
	domains: string[];
}

export const SCHOOL_DIRECTORY: readonly SchoolDirectoryEntry[] = [
	{ id: 'mit', name: 'MIT', country: 'US', domains: ['mit.edu'] },
	{ id: 'stanford', name: 'Stanford', country: 'US', domains: ['stanford.edu'] },
	{
		id: 'harvard',
		name: 'Harvard',
		country: 'US',
		domains: ['harvard.edu', 'college.harvard.edu', 'hbs.edu']
	},
	{ id: 'caltech', name: 'Caltech', country: 'US', domains: ['caltech.edu'] },
	{ id: 'berkeley', name: 'UC Berkeley', country: 'US', domains: ['berkeley.edu'] },
	{ id: 'princeton', name: 'Princeton', country: 'US', domains: ['princeton.edu'] },
	{ id: 'yale', name: 'Yale', country: 'US', domains: ['yale.edu', 'som.yale.edu'] },
	{ id: 'upenn', name: 'Penn (UPenn)', country: 'US', domains: ['upenn.edu', 'wharton.upenn.edu'] },
	{ id: 'cornell', name: 'Cornell', country: 'US', domains: ['cornell.edu'] },
	{
		id: 'columbia',
		name: 'Columbia',
		country: 'US',
		domains: ['columbia.edu', 'gsb.columbia.edu']
	},
	{
		id: 'chicago',
		name: 'University of Chicago',
		country: 'US',
		domains: ['uchicago.edu', 'chicagobooth.edu']
	},
	{
		id: 'dartmouth',
		name: 'Dartmouth',
		country: 'US',
		domains: ['dartmouth.edu', 'tuck.dartmouth.edu']
	},
	{ id: 'brown', name: 'Brown', country: 'US', domains: ['brown.edu'] },
	{ id: 'jhu', name: 'Johns Hopkins', country: 'US', domains: ['jhu.edu', 'jh.edu'] },
	{
		id: 'northwestern',
		name: 'Northwestern',
		country: 'US',
		domains: ['northwestern.edu', 'kellogg.northwestern.edu']
	},
	{ id: 'duke', name: 'Duke', country: 'US', domains: ['duke.edu', 'fuqua.duke.edu'] },
	{ id: 'cmu', name: 'Carnegie Mellon', country: 'US', domains: ['cmu.edu', 'andrew.cmu.edu'] },
	{
		id: 'umich',
		name: 'Michigan (Ann Arbor)',
		country: 'US',
		domains: ['umich.edu', 'ross.umich.edu']
	},
	{ id: 'ucla', name: 'UCLA', country: 'US', domains: ['ucla.edu', 'anderson.ucla.edu'] },
	{ id: 'usc', name: 'USC', country: 'US', domains: ['usc.edu', 'marshall.usc.edu'] },
	{ id: 'nyu', name: 'NYU', country: 'US', domains: ['nyu.edu', 'stern.nyu.edu'] },
	{ id: 'georgetown', name: 'Georgetown', country: 'US', domains: ['georgetown.edu', 'msb.edu'] },
	{ id: 'georgiatech', name: 'Georgia Tech', country: 'US', domains: ['gatech.edu'] },
	{ id: 'umd', name: 'Maryland', country: 'US', domains: ['umd.edu', 'umaryland.edu'] },
	{ id: 'utexas', name: 'UT Austin', country: 'US', domains: ['utexas.edu', 'mccombs.utexas.edu'] },
	{
		id: 'wustl',
		name: 'Washington (St. Louis)',
		country: 'US',
		domains: ['wustl.edu', 'olin.wustl.edu']
	},
	{ id: 'rice', name: 'Rice', country: 'US', domains: ['rice.edu'] },
	{ id: 'emory', name: 'Emory', country: 'US', domains: ['emory.edu', 'goizueta.emory.edu'] },
	{ id: 'notredame', name: 'Notre Dame', country: 'US', domains: ['nd.edu', 'mendoza.nd.edu'] },
	{
		id: 'vanderbilt',
		name: 'Vanderbilt',
		country: 'US',
		domains: ['vanderbilt.edu', 'owen.vanderbilt.edu']
	},
	{ id: 'tufts', name: 'Tufts', country: 'US', domains: ['tufts.edu'] },
	{
		id: 'unc',
		name: 'UNC Chapel Hill',
		country: 'US',
		domains: ['unc.edu', 'kenan-flagler.unc.edu']
	},
	{
		id: 'uva',
		name: 'Virginia (UVA)',
		country: 'US',
		domains: ['virginia.edu', 'darden.virginia.edu']
	},
	{ id: 'uwisc', name: 'Wisconsin–Madison', country: 'US', domains: ['wisc.edu'] },
	{ id: 'uiuc', name: 'Illinois Urbana-Champaign', country: 'US', domains: ['illinois.edu'] },
	{ id: 'osu', name: 'Ohio State', country: 'US', domains: ['osu.edu'] },
	{ id: 'psu', name: 'Penn State', country: 'US', domains: ['psu.edu'] },
	{ id: 'purdue', name: 'Purdue', country: 'US', domains: ['purdue.edu'] },
	{ id: 'wm', name: 'William & Mary', country: 'US', domains: ['wm.edu', 'mason.wm.edu'] },
	{ id: 'bc', name: 'Boston College', country: 'US', domains: ['bc.edu'] },
	{ id: 'tulane', name: 'Tulane', country: 'US', domains: ['tulane.edu', 'freeman.tulane.edu'] },
	{ id: 'lehigh', name: 'Lehigh', country: 'US', domains: ['lehigh.edu'] },
	{ id: 'rpi', name: 'Rensselaer', country: 'US', domains: ['rpi.edu'] },
	{ id: 'uw', name: 'Washington (Seattle)', country: 'US', domains: ['uw.edu', 'foster.uw.edu'] },
	{ id: 'ucsd', name: 'UC San Diego', country: 'US', domains: ['ucsd.edu'] },
	{ id: 'uci', name: 'UC Irvine', country: 'US', domains: ['uci.edu', 'merage.uci.edu'] },
	{ id: 'ucsb', name: 'UC Santa Barbara', country: 'US', domains: ['ucsb.edu'] },
	{ id: 'ucdavis', name: 'UC Davis', country: 'US', domains: ['ucdavis.edu'] },
	{ id: 'bu', name: 'Boston University', country: 'US', domains: ['bu.edu', 'questrom.bu.edu'] },
	{
		id: 'umn',
		name: 'Minnesota (Twin Cities)',
		country: 'US',
		domains: ['umn.edu', 'carlsonschool.umn.edu']
	},
	{ id: 'asu', name: 'Arizona State', country: 'US', domains: ['asu.edu'] },
	{ id: 'uf', name: 'Florida', country: 'US', domains: ['ufl.edu', 'warrington.ufl.edu'] },
	{ id: 'uconn', name: 'Connecticut', country: 'US', domains: ['uconn.edu'] },
	{ id: 'miami', name: 'Miami', country: 'US', domains: ['miami.edu', 'bus.miami.edu'] },
	{
		id: 'rutgers',
		name: 'Rutgers',
		country: 'US',
		domains: ['rutgers.edu', 'business.rutgers.edu']
	},
	{ id: 'vt', name: 'Virginia Tech', country: 'US', domains: ['vt.edu'] },
	{
		id: 'rochester',
		name: 'Rochester',
		country: 'US',
		domains: ['rochester.edu', 'simon.rochester.edu']
	},
	{
		id: 'northeastern',
		name: 'Northeastern',
		country: 'US',
		domains: ['northeastern.edu', 'damore-mckim.northeastern.edu']
	},
	{
		id: 'case',
		name: 'Case Western Reserve',
		country: 'US',
		domains: ['case.edu', 'weatherhead.case.edu']
	},
	{ id: 'uri', name: 'Rhode Island', country: 'US', domains: ['uri.edu'] },
	{ id: 'uga', name: 'Georgia', country: 'US', domains: ['uga.edu', 'terry.uga.edu'] },
	{ id: 'iowa', name: 'Iowa', country: 'US', domains: ['uiowa.edu', 'tippie.uiowa.edu'] },
	{ id: 'su', name: 'Syracuse', country: 'US', domains: ['syr.edu', 'whitman.syr.edu'] },
	{ id: 'drexel', name: 'Drexel', country: 'US', domains: ['drexel.edu', 'lebow.drexel.edu'] },
	{ id: 'uic', name: 'Illinois Chicago', country: 'US', domains: ['uic.edu', 'liautaud.uic.edu'] },
	{ id: 'pitt', name: 'Pittsburgh', country: 'US', domains: ['pitt.edu', 'katz.pitt.edu'] },
	{ id: 'msu', name: 'Michigan State', country: 'US', domains: ['msu.edu', 'broad.msu.edu'] },
	{ id: 'uoregon', name: 'Oregon', country: 'US', domains: ['uoregon.edu', 'lcb.uoregon.edu'] },
	{ id: 'villanova', name: 'Villanova', country: 'US', domains: ['villanova.edu'] },
	{
		id: 'cu',
		name: 'Colorado Boulder',
		country: 'US',
		domains: ['colorado.edu', 'leeds.colorado.edu']
	},
	{ id: 'utah', name: 'Utah', country: 'US', domains: ['utah.edu', 'eccles.utah.edu'] },
	{
		id: 'umass',
		name: 'UMass Amherst',
		country: 'US',
		domains: ['umass.edu', 'isenberg.umass.edu']
	},
	{ id: 'texasam', name: 'Texas A&M', country: 'US', domains: ['tamu.edu', 'mays.tamu.edu'] },
	{ id: 'uok', name: 'Oklahoma', country: 'US', domains: ['ou.edu', 'price.ou.edu'] },
	{ id: 'clemson', name: 'Clemson', country: 'US', domains: ['clemson.edu'] },
	{ id: 'babson', name: 'Babson College', country: 'US', domains: ['babson.edu'] },
	{ id: 'bentley', name: 'Bentley', country: 'US', domains: ['bentley.edu'] },
	{ id: 'claremont', name: 'Claremont McKenna', country: 'US', domains: ['cmc.edu'] },
	{ id: 'hmc', name: 'Harvey Mudd', country: 'US', domains: ['hmc.edu'] },
	{ id: 'wellesley', name: 'Wellesley', country: 'US', domains: ['wellesley.edu'] },
	{ id: 'amherst', name: 'Amherst', country: 'US', domains: ['amherst.edu'] },
	{ id: 'williams', name: 'Williams', country: 'US', domains: ['williams.edu'] },
	{ id: 'oxford', name: 'Oxford', country: 'GB', domains: ['ox.ac.uk', 'sbs.ox.ac.uk'] },
	{ id: 'cambridge', name: 'Cambridge', country: 'GB', domains: ['cam.ac.uk', 'jbs.cam.ac.uk'] },
	{
		id: 'imperial',
		name: 'Imperial College London',
		country: 'GB',
		domains: ['imperial.ac.uk', 'imperial.edu']
	},
	{ id: 'lse', name: 'LSE', country: 'GB', domains: ['lse.ac.uk'] },
	{ id: 'ucl', name: 'UCL', country: 'GB', domains: ['ucl.ac.uk'] },
	{
		id: 'edinburgh',
		name: 'Edinburgh',
		country: 'GB',
		domains: ['ed.ac.uk', 'business-school.ed.ac.uk']
	},
	{ id: 'kings', name: "King's College London", country: 'GB', domains: ['kcl.ac.uk'] },
	{ id: 'warwick', name: 'Warwick', country: 'GB', domains: ['warwick.ac.uk', 'wbs.ac.uk'] },
	{
		id: 'manchester',
		name: 'Manchester',
		country: 'GB',
		domains: ['manchester.ac.uk', 'mbs.ac.uk']
	},
	{ id: 'bristol', name: 'Bristol', country: 'GB', domains: ['bristol.ac.uk'] },
	{ id: 'durham', name: 'Durham', country: 'GB', domains: ['durham.ac.uk'] },
	{ id: 'standrews', name: 'St Andrews', country: 'GB', domains: ['st-andrews.ac.uk'] },
	{ id: 'glasgow', name: 'Glasgow', country: 'GB', domains: ['glasgow.ac.uk'] },
	{ id: 'lbs', name: 'London Business School', country: 'GB', domains: ['london.edu'] },
	{ id: 'leeds', name: 'Leeds', country: 'GB', domains: ['leeds.ac.uk'] },
	{ id: 'birmingham', name: 'Birmingham', country: 'GB', domains: ['bham.ac.uk'] },
	{ id: 'southampton', name: 'Southampton', country: 'GB', domains: ['soton.ac.uk'] },
	{ id: 'nottingham', name: 'Nottingham', country: 'GB', domains: ['nottingham.ac.uk'] },
	{ id: 'sheffield', name: 'Sheffield', country: 'GB', domains: ['sheffield.ac.uk'] },
	{ id: 'queenmary', name: 'Queen Mary', country: 'GB', domains: ['qmul.ac.uk'] },
	{ id: 'cardiff', name: 'Cardiff', country: 'GB', domains: ['cardiff.ac.uk'] },
	{ id: 'lancaster', name: 'Lancaster', country: 'GB', domains: ['lancaster.ac.uk'] },
	{ id: 'exeter', name: 'Exeter', country: 'GB', domains: ['exeter.ac.uk'] },
	{ id: 'bath', name: 'Bath', country: 'GB', domains: ['bath.ac.uk'] },
	{ id: 'hull', name: 'Hull', country: 'GB', domains: ['hull.ac.uk'] },
	{
		id: 'whu',
		name: 'WHU - Otto Beisheim School of Management',
		country: 'DE',
		domains: ['whu.edu']
	},
	{ id: 'eth', name: 'ETH Zürich', country: 'CH', domains: ['ethz.ch'] },
	{ id: 'epfl', name: 'EPFL', country: 'CH', domains: ['epfl.ch'] },
	{ id: 'tum', name: 'TU Munich', country: 'DE', domains: ['tum.de'] },
	{ id: 'lmu', name: 'LMU Munich', country: 'DE', domains: ['lmu.de', 'campus.lmu.de'] },
	{ id: 'humboldt', name: 'Humboldt Berlin', country: 'DE', domains: ['hu-berlin.de'] },
	{ id: 'fu-berlin', name: 'Freie Universität Berlin', country: 'DE', domains: ['fu-berlin.de'] },
	{ id: 'heidelberg', name: 'Heidelberg', country: 'DE', domains: ['uni-heidelberg.de'] },
	{ id: 'rwth', name: 'RWTH Aachen', country: 'DE', domains: ['rwth-aachen.de'] },
	{ id: 'mannheim', name: 'Mannheim', country: 'DE', domains: ['uni-mannheim.de'] },
	{ id: 'frankfurt', name: 'Frankfurt (Goethe)', country: 'DE', domains: ['uni-frankfurt.de'] },
	{ id: 'koeln', name: 'Cologne (Köln)', country: 'DE', domains: ['uni-koeln.de'] },
	{ id: 'bonn', name: 'Bonn', country: 'DE', domains: ['uni-bonn.de'] },
	{ id: 'hsg', name: 'St. Gallen (HSG)', country: 'CH', domains: ['unisg.ch', 'student.unisg.ch'] },
	{ id: 'uzh', name: 'Zürich', country: 'CH', domains: ['uzh.ch'] },
	{ id: 'ebs', name: 'EBS Oestrich-Winkel', country: 'DE', domains: ['ebs.edu'] },
	{ id: 'hhl', name: 'HHL Leipzig', country: 'DE', domains: ['hhl.de'] },
	{ id: 'esmt', name: 'ESMT Berlin', country: 'DE', domains: ['esmt.org'] },
	{ id: 'sorbonne', name: 'Sorbonne', country: 'FR', domains: ['sorbonne-universite.fr'] },
	{ id: 'sciencespo', name: 'Sciences Po', country: 'FR', domains: ['sciencespo.fr'] },
	{ id: 'ens', name: 'ENS Paris', country: 'FR', domains: ['ens.psl.eu', 'ens.fr'] },
	{ id: 'insead', name: 'INSEAD', country: 'FR', domains: ['insead.edu'] },
	{ id: 'hec', name: 'HEC Paris', country: 'FR', domains: ['hec.edu'] },
	{ id: 'essec', name: 'ESSEC', country: 'FR', domains: ['essec.edu'] },
	{ id: 'escp', name: 'ESCP', country: 'FR', domains: ['escp.eu'] },
	{ id: 'emlyon', name: 'emlyon', country: 'FR', domains: ['em-lyon.com', 'emlyon.com'] },
	{
		id: 'paris-dauphine',
		name: 'Paris Dauphine',
		country: 'FR',
		domains: ['dauphine.psl.eu', 'dauphine.fr']
	},
	{
		id: 'polytechnique',
		name: 'École Polytechnique',
		country: 'FR',
		domains: ['polytechnique.edu']
	},
	{ id: 'bocconi', name: 'Bocconi', country: 'IT', domains: ['unibocconi.it'] },
	{
		id: 'polimi',
		name: 'Politecnico di Milano',
		country: 'IT',
		domains: ['polimi.it', 'mail.polimi.it']
	},
	{ id: 'sapienza', name: 'Sapienza Roma', country: 'IT', domains: ['uniroma1.it'] },
	{
		id: 'unicatt',
		name: 'Università Cattolica',
		country: 'IT',
		domains: ['unicatt.it', 'icatt.it']
	},
	{ id: 'iese', name: 'IESE', country: 'ES', domains: ['iese.edu', 'iese.net'] },
	{
		id: 'iebusiness',
		name: 'IE Business School',
		country: 'ES',
		domains: ['ie.edu', 'student.ie.edu']
	},
	{ id: 'esade', name: 'ESADE', country: 'ES', domains: ['esade.edu'] },
	{ id: 'barcelona', name: 'Barcelona (UB)', country: 'ES', domains: ['ub.edu'] },
	{ id: 'uam', name: 'Madrid Autónoma', country: 'ES', domains: ['uam.es'] },
	{ id: 'uc3m', name: 'Carlos III Madrid', country: 'ES', domains: ['uc3m.es'] },
	{ id: 'tudelft', name: 'TU Delft', country: 'NL', domains: ['tudelft.nl'] },
	{ id: 'utrecht', name: 'Utrecht', country: 'NL', domains: ['uu.nl', 'students.uu.nl'] },
	{
		id: 'leiden',
		name: 'Leiden',
		country: 'NL',
		domains: ['leidenuniv.nl', 'universiteitleiden.nl']
	},
	{
		id: 'amsterdam',
		name: 'Amsterdam (UvA)',
		country: 'NL',
		domains: ['uva.nl', 'student.uva.nl']
	},
	{ id: 'rsm', name: 'Rotterdam (RSM)', country: 'NL', domains: ['rsm.nl', 'eur.nl'] },
	{ id: 'vu', name: 'VU Amsterdam', country: 'NL', domains: ['vu.nl'] },
	{ id: 'groningen', name: 'Groningen', country: 'NL', domains: ['rug.nl'] },
	{ id: 'eindhoven', name: 'TU Eindhoven', country: 'NL', domains: ['tue.nl'] },
	{ id: 'kuleuven', name: 'KU Leuven', country: 'BE', domains: ['kuleuven.be'] },
	{ id: 'ulb', name: 'Université Libre de Bruxelles', country: 'BE', domains: ['ulb.be'] },
	{ id: 'ghent', name: 'Ghent', country: 'BE', domains: ['ugent.be'] },
	{ id: 'copenhagen', name: 'Copenhagen', country: 'DK', domains: ['ku.dk'] },
	{
		id: 'cbs',
		name: 'Copenhagen Business School',
		country: 'DK',
		domains: ['cbs.dk', 'student.cbs.dk']
	},
	{ id: 'aarhus', name: 'Aarhus', country: 'DK', domains: ['au.dk'] },
	{ id: 'dtu', name: 'Technical Univ of Denmark', country: 'DK', domains: ['dtu.dk'] },
	{
		id: 'karolinska',
		name: 'Karolinska Institutet',
		country: 'SE',
		domains: ['ki.se', 'student.ki.se']
	},
	{ id: 'lund', name: 'Lund', country: 'SE', domains: ['lu.se', 'student.lu.se'] },
	{ id: 'uppsala', name: 'Uppsala', country: 'SE', domains: ['uu.se', 'student.uu.se'] },
	{
		id: 'sse',
		name: 'Stockholm School of Economics',
		country: 'SE',
		domains: ['hhs.se', 'student.hhs.se']
	},
	{ id: 'kth', name: 'KTH Stockholm', country: 'SE', domains: ['kth.se'] },
	{
		id: 'helsinki',
		name: 'Helsinki',
		country: 'FI',
		domains: ['helsinki.fi', 'student.helsinki.fi']
	},
	{ id: 'aalto', name: 'Aalto', country: 'FI', domains: ['aalto.fi', 'student.aalto.fi'] },
	{ id: 'oslo', name: 'Oslo', country: 'NO', domains: ['uio.no', 'student.uio.no'] },
	{ id: 'nhh', name: 'NHH Bergen', country: 'NO', domains: ['nhh.no', 'student.nhh.no'] },
	{
		id: 'vienna',
		name: 'Vienna (Universität Wien)',
		country: 'AT',
		domains: ['univie.ac.at', 'unet.univie.ac.at']
	},
	{ id: 'wu-vienna', name: 'WU Vienna', country: 'AT', domains: ['wu.ac.at', 's.wu.ac.at'] },
	{ id: 'trinity', name: 'Trinity College Dublin', country: 'IE', domains: ['tcd.ie'] },
	{ id: 'ucd', name: 'UCD Dublin', country: 'IE', domains: ['ucd.ie'] },
	{ id: 'lisbon', name: 'Lisbon (ULisboa)', country: 'PT', domains: ['ulisboa.pt'] },
	{ id: 'nova-sbe', name: 'Nova SBE', country: 'PT', domains: ['novasbe.pt', 'novasbe.unl.pt'] },
	{ id: 'warsaw', name: 'Warsaw', country: 'PL', domains: ['uw.edu.pl'] },
	{ id: 'charles', name: 'Charles University Prague', country: 'CZ', domains: ['cuni.cz'] },
	{ id: 'elte', name: 'Eötvös Loránd', country: 'HU', domains: ['elte.hu', 'student.elte.hu'] },
	{ id: 'athens', name: 'Athens (NKUA)', country: 'GR', domains: ['uoa.gr'] },
	{ id: 'tokyo', name: 'Tokyo', country: 'JP', domains: ['u-tokyo.ac.jp', 'g.ecc.u-tokyo.ac.jp'] },
	{ id: 'kyoto', name: 'Kyoto', country: 'JP', domains: ['kyoto-u.ac.jp', 'st.kyoto-u.ac.jp'] },
	{ id: 'osaka', name: 'Osaka', country: 'JP', domains: ['osaka-u.ac.jp'] },
	{
		id: 'tokyo-tech',
		name: 'Science Tokyo (Tokyo Tech)',
		country: 'JP',
		domains: ['titech.ac.jp', 'isct.ac.jp']
	},
	{ id: 'keio', name: 'Keio', country: 'JP', domains: ['keio.jp', 'keio.ac.jp'] },
	{ id: 'waseda', name: 'Waseda', country: 'JP', domains: ['waseda.jp', 'aoni.waseda.jp'] },
	{ id: 'tohoku', name: 'Tohoku', country: 'JP', domains: ['tohoku.ac.jp', 'dc.tohoku.ac.jp'] },
	{ id: 'hitotsubashi', name: 'Hitotsubashi', country: 'JP', domains: ['hit-u.ac.jp'] },
	{
		id: 'tsinghua',
		name: 'Tsinghua',
		country: 'CN',
		domains: ['tsinghua.edu.cn', 'mails.tsinghua.edu.cn']
	},
	{ id: 'peking', name: 'Peking', country: 'CN', domains: ['pku.edu.cn', 'stu.pku.edu.cn'] },
	{ id: 'fudan', name: 'Fudan', country: 'CN', domains: ['fudan.edu.cn', 'm.fudan.edu.cn'] },
	{ id: 'sjtu', name: 'Shanghai Jiao Tong', country: 'CN', domains: ['sjtu.edu.cn'] },
	{ id: 'zju', name: 'Zhejiang', country: 'CN', domains: ['zju.edu.cn'] },
	{ id: 'ceibs', name: 'CEIBS', country: 'CN', domains: ['ceibs.edu'] },
	{ id: 'hku', name: 'HKU', country: 'HK', domains: ['hku.hk', 'connect.hku.hk'] },
	{ id: 'hkust', name: 'HKUST', country: 'HK', domains: ['ust.hk', 'connect.ust.hk'] },
	{ id: 'cuhk', name: 'CUHK', country: 'HK', domains: ['cuhk.edu.hk', 'link.cuhk.edu.hk'] },
	{ id: 'cityuhk', name: 'City University of Hong Kong', country: 'HK', domains: ['cityu.edu.hk'] },
	{
		id: 'polyuhk',
		name: 'PolyU Hong Kong',
		country: 'HK',
		domains: ['polyu.edu.hk', 'connect.polyu.hk']
	},
	{ id: 'nus', name: 'NUS', country: 'SG', domains: ['nus.edu.sg', 'u.nus.edu'] },
	{ id: 'ntu', name: 'NTU Singapore', country: 'SG', domains: ['ntu.edu.sg', 'e.ntu.edu.sg'] },
	{ id: 'smu-sg', name: 'SMU Singapore', country: 'SG', domains: ['smu.edu.sg'] },
	{ id: 'snu', name: 'Seoul National', country: 'KR', domains: ['snu.ac.kr'] },
	{ id: 'kaist', name: 'KAIST', country: 'KR', domains: ['kaist.ac.kr'] },
	{ id: 'yonsei', name: 'Yonsei', country: 'KR', domains: ['yonsei.ac.kr'] },
	{ id: 'korea-u', name: 'Korea University', country: 'KR', domains: ['korea.ac.kr'] },
	{ id: 'postech', name: 'POSTECH', country: 'KR', domains: ['postech.ac.kr'] },
	{ id: 'iitb', name: 'IIT Bombay', country: 'IN', domains: ['iitb.ac.in'] },
	{ id: 'iitd', name: 'IIT Delhi', country: 'IN', domains: ['iitd.ac.in'] },
	{ id: 'iitm', name: 'IIT Madras', country: 'IN', domains: ['iitm.ac.in', 'smail.iitm.ac.in'] },
	{ id: 'iitk', name: 'IIT Kanpur', country: 'IN', domains: ['iitk.ac.in'] },
	{ id: 'iitkgp', name: 'IIT Kharagpur', country: 'IN', domains: ['iitkgp.ac.in'] },
	{ id: 'iisc', name: 'IISc Bangalore', country: 'IN', domains: ['iisc.ac.in'] },
	{ id: 'iima', name: 'IIM Ahmedabad', country: 'IN', domains: ['iima.ac.in'] },
	{ id: 'iimb', name: 'IIM Bangalore', country: 'IN', domains: ['iimb.ac.in'] },
	{ id: 'iimc', name: 'IIM Calcutta', country: 'IN', domains: ['iimcal.ac.in'] },
	{ id: 'isb', name: 'Indian School of Business', country: 'IN', domains: ['isb.edu'] },
	{ id: 'delhi-u', name: 'Delhi University', country: 'IN', domains: ['du.ac.in'] },
	{ id: 'jnu', name: 'JNU New Delhi', country: 'IN', domains: ['jnu.ac.in'] },
	{ id: 'ntu-tw', name: 'NTU Taiwan', country: 'TW', domains: ['ntu.edu.tw'] },
	{ id: 'nthu-tw', name: 'NTHU Taiwan', country: 'TW', domains: ['nthu.edu.tw'] },
	{ id: 'um', name: 'Universiti Malaya', country: 'MY', domains: ['um.edu.my', 'siswa.um.edu.my'] },
	{
		id: 'chulalongkorn',
		name: 'Chulalongkorn',
		country: 'TH',
		domains: ['chula.ac.th', 'student.chula.ac.th']
	},
	{
		id: 'mahidol',
		name: 'Mahidol',
		country: 'TH',
		domains: ['mahidol.ac.th', 'student.mahidol.ac.th']
	},
	{ id: 'ui', name: 'Universitas Indonesia', country: 'ID', domains: ['ui.ac.id'] },
	{ id: 'ugm', name: 'Gadjah Mada', country: 'ID', domains: ['ugm.ac.id', 'mail.ugm.ac.id'] },
	{ id: 'itb', name: 'ITB Bandung', country: 'ID', domains: ['itb.ac.id', 'students.itb.ac.id'] },
	{ id: 'updiliman', name: 'UP Diliman', country: 'PH', domains: ['up.edu.ph'] },
	{ id: 'ateneo', name: 'Ateneo de Manila', country: 'PH', domains: ['ateneo.edu'] },
	{ id: 'vnu', name: 'Vietnam National University', country: 'VN', domains: ['vnu.edu.vn'] },
	{
		id: 'huji',
		name: 'Hebrew University Jerusalem',
		country: 'IL',
		domains: ['huji.ac.il', 'mail.huji.ac.il']
	},
	{ id: 'telaviv', name: 'Tel Aviv', country: 'IL', domains: ['tau.ac.il', 'mail.tau.ac.il'] },
	{
		id: 'technion',
		name: 'Technion',
		country: 'IL',
		domains: ['technion.ac.il', 'campus.technion.ac.il']
	},
	{
		id: 'idc',
		name: 'Reichman University',
		country: 'IL',
		domains: ['runi.ac.il', 'post.runi.ac.il']
	},
	{
		id: 'unimelb',
		name: 'Melbourne',
		country: 'AU',
		domains: ['unimelb.edu.au', 'student.unimelb.edu.au']
	},
	{ id: 'sydney', name: 'Sydney', country: 'AU', domains: ['sydney.edu.au', 'uni.sydney.edu.au'] },
	{
		id: 'unsw',
		name: 'UNSW Sydney',
		country: 'AU',
		domains: ['unsw.edu.au', 'student.unsw.edu.au']
	},
	{ id: 'anu', name: 'ANU', country: 'AU', domains: ['anu.edu.au'] },
	{ id: 'monash', name: 'Monash', country: 'AU', domains: ['monash.edu', 'student.monash.edu'] },
	{ id: 'uq', name: 'Queensland (UQ)', country: 'AU', domains: ['uq.edu.au', 'student.uq.edu.au'] },
	{
		id: 'uwa',
		name: 'Western Australia (UWA)',
		country: 'AU',
		domains: ['uwa.edu.au', 'student.uwa.edu.au']
	},
	{
		id: 'adelaide',
		name: 'Adelaide',
		country: 'AU',
		domains: ['adelaide.edu.au', 'student.adelaide.edu.au']
	},
	{ id: 'uts', name: 'UTS Sydney', country: 'AU', domains: ['uts.edu.au', 'student.uts.edu.au'] },
	{
		id: 'macquarie',
		name: 'Macquarie',
		country: 'AU',
		domains: ['mq.edu.au', 'students.mq.edu.au']
	},
	{ id: 'rmit', name: 'RMIT', country: 'AU', domains: ['rmit.edu.au', 'student.rmit.edu.au'] },
	{
		id: 'curtin',
		name: 'Curtin',
		country: 'AU',
		domains: ['curtin.edu.au', 'student.curtin.edu.au']
	},
	{
		id: 'auckland',
		name: 'Auckland',
		country: 'NZ',
		domains: ['auckland.ac.nz', 'aucklanduni.ac.nz']
	},
	{ id: 'otago', name: 'Otago', country: 'NZ', domains: ['otago.ac.nz', 'student.otago.ac.nz'] },
	{
		id: 'victoria-wlg',
		name: 'Wellington (VUW)',
		country: 'NZ',
		domains: ['vuw.ac.nz', 'myvuw.ac.nz']
	},
	{ id: 'toronto', name: 'Toronto', country: 'CA', domains: ['utoronto.ca', 'mail.utoronto.ca'] },
	{ id: 'mcgill', name: 'McGill', country: 'CA', domains: ['mcgill.ca', 'mail.mcgill.ca'] },
	{ id: 'ubc', name: 'UBC', country: 'CA', domains: ['ubc.ca', 'student.ubc.ca', 'mail.ubc.ca'] },
	{ id: 'mcmaster', name: 'McMaster', country: 'CA', domains: ['mcmaster.ca'] },
	{ id: 'montreal', name: 'Montréal', country: 'CA', domains: ['umontreal.ca'] },
	{ id: 'alberta', name: 'Alberta', country: 'CA', domains: ['ualberta.ca'] },
	{
		id: 'waterloo',
		name: 'Waterloo',
		country: 'CA',
		domains: ['uwaterloo.ca', 'edu.uwaterloo.ca']
	},
	{ id: 'western-on', name: 'Western Ontario', country: 'CA', domains: ['uwo.ca'] },
	{ id: 'queens', name: "Queen's University", country: 'CA', domains: ['queensu.ca'] },
	{ id: 'calgary', name: 'Calgary', country: 'CA', domains: ['ucalgary.ca'] },
	{ id: 'ottawa', name: 'Ottawa', country: 'CA', domains: ['uottawa.ca'] },
	{ id: 'sfu', name: 'Simon Fraser', country: 'CA', domains: ['sfu.ca'] },
	{ id: 'usp', name: 'São Paulo (USP)', country: 'BR', domains: ['usp.br'] },
	{ id: 'unicamp', name: 'Unicamp', country: 'BR', domains: ['unicamp.br', 'dac.unicamp.br'] },
	{ id: 'puc-rio', name: 'PUC-Rio', country: 'BR', domains: ['puc-rio.br', 'aluno.puc-rio.br'] },
	{ id: 'fgv', name: 'Fundação Getulio Vargas', country: 'BR', domains: ['fgv.br', 'fgvmail.br'] },
	{ id: 'unam', name: 'UNAM', country: 'MX', domains: ['unam.mx', 'comunidad.unam.mx'] },
	{
		id: 'itesm',
		name: 'Tecnológico de Monterrey',
		country: 'MX',
		domains: ['tec.mx', 'exatec.tec.mx']
	},
	{ id: 'uchile', name: 'Chile', country: 'CL', domains: ['uchile.cl', 'ug.uchile.cl'] },
	{ id: 'uc-cl', name: 'PUC Chile', country: 'CL', domains: ['uc.cl', 'estudiante.uc.cl'] },
	{ id: 'kaust', name: 'KAUST', country: 'SA', domains: ['kaust.edu.sa'] },
	{
		id: 'aub',
		name: 'American Univ of Beirut',
		country: 'LB',
		domains: ['aub.edu.lb', 'mail.aub.edu']
	},
	{ id: 'auc', name: 'American Univ in Cairo', country: 'EG', domains: ['aucegypt.edu'] },
	{ id: 'cairo-u', name: 'Cairo University', country: 'EG', domains: ['cu.edu.eg'] },
	{ id: 'uct', name: 'Cape Town', country: 'ZA', domains: ['uct.ac.za', 'myuct.ac.za'] },
	{
		id: 'wits',
		name: 'Witwatersrand (Wits)',
		country: 'ZA',
		domains: ['wits.ac.za', 'students.wits.ac.za']
	},
	{ id: 'stellenbosch', name: 'Stellenbosch', country: 'ZA', domains: ['sun.ac.za'] },
	{ id: 'koc', name: 'Koç University', country: 'TR', domains: ['ku.edu.tr', 'student.ku.edu.tr'] },
	{ id: 'bogazici', name: 'Boğaziçi', country: 'TR', domains: ['boun.edu.tr'] },
	{ id: 'metu', name: 'METU Ankara', country: 'TR', domains: ['metu.edu.tr'] },
	{ id: 'itam', name: 'ITAM', country: 'MX', domains: ['itam.mx'] }
];
