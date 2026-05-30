// Global State
let RAW_DATA = [];
let NORMALIZED_DATA = []; // Team-game records
let RECONSTRUCTED_MATCHES = []; // Pairwise matches
let ELO_HISTORY = {};
let FINAL_ELOS = {};

// DOM Elements
const onboardingContainer = document.getElementById('view-onboarding');
const dropZone = document.getElementById('onboarding-drop-zone');
const onboardingFileInput = document.getElementById('onboarding-file-input');
const sidebarFileInput = document.getElementById('sidebar-file-input');
const sidebarUploadBtn = document.getElementById('sidebar-upload-btn');
const btnReset = document.getElementById('btn-reset');

const sectionNav = document.getElementById('section-nav');
const sectionFilters = document.getElementById('section-filters');

const selectCompetition = document.getElementById('select-competition');
const selectSeason = document.getElementById('select-season');
const multiTeams = document.getElementById('multi-teams');

// Onboarding triggers
if (dropZone) dropZone.addEventListener('click', () => onboardingFileInput.click());
if (onboardingFileInput) onboardingFileInput.addEventListener('change', handleFileSelect);
if (sidebarUploadBtn) sidebarUploadBtn.addEventListener('click', () => sidebarFileInput.click());
if (sidebarFileInput) sidebarFileInput.addEventListener('change', handleFileSelect);

// Reset Trigger
if (btnReset) btnReset.addEventListener('click', resetDashboard);

// Drag over effects
if (dropZone) {
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        }, false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        }, false);
    });
    
    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            parseCSVFile(files[0]);
        }
    });
}

// ----------------------------------------------------
// FILE READING & PARSING
// ----------------------------------------------------
function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        parseCSVFile(files[0]);
    }
}

function parseCSVFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const rows = parseCSVText(text);
        if (rows.length > 0) {
            RAW_DATA = rows;
            initializeDashboard(rows);
        } else {
            alert('Die hochgeladene Datei ist leer oder ungültig.');
        }
    };
    reader.readAsText(file);
}

function parseCSVText(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) return [];
    
    let sep = ',';
    if (lines[0].includes(';')) sep = ';';
    
    const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(sep).map(v => v.trim().replace(/^["']|["']$/g, ''));
        if (vals.length !== headers.length) continue;
        
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = vals[j];
        }
        data.push(row);
    }
    return data;
}

// ----------------------------------------------------
// HYBRID DATA PROCESSING & NORMALIZATION ENGINE
// ----------------------------------------------------
function processUploadedData(rawData) {
    // 1. Detect if columns contain match-level team definitions (home/away)
    let isMatchLevel = false;
    let homeKey = '', awayKey = '', ghKey = '', gaKey = '', phKey = '', paKey = '';
    let compKey = '', seasonKey = '', mdKey = '';

    const sample = rawData[0] || {};
    for (let key in sample) {
        const k = key.trim().toLowerCase();
        if (k === 'home_team' || k === 'home team' || k === 'heimteam' || k === 'heim_team') {
            isMatchLevel = true;
            homeKey = key;
        } else if (k === 'away_team' || k === 'away team' || k === 'auswärtsteam' || k === 'auswärts_team') {
            awayKey = key;
        } else if (k === 'goals_home' || k === 'home_goals' || k === 'goals home' || k === 'home goals' || k === 'heimtore' || k === 'tore_heim') {
            ghKey = key;
        } else if (k === 'goals_away' || k === 'away_goals' || k === 'goals away' || k === 'away goals' || k === 'auswärtstore' || k === 'tore_gast') {
            gaKey = key;
        } else if (k === 'possession_home' || k === 'ballbesitz_heim') {
            phKey = key;
        } else if (k === 'possession_away' || k === 'ballbesitz_auswärts') {
            paKey = key;
        } else if (k === 'competition' || k === 'liga' || k === 'wettbewerb') {
            compKey = key;
        } else if (k === 'season' || k === 'saison') {
            seasonKey = key;
        } else if (k === 'spieltag' || k === 'matchday' || k === 'round' || k === 'runde') {
            mdKey = key;
        }
    }

    if (isMatchLevel) {
        // --- MODE A: MATCH-LEVEL CSV PROCESSING ---
        const matches = [];
        const teamGames = [];

        rawData.forEach(row => {
            const hTeam = row[homeKey];
            const aTeam = row[awayKey];
            if (!hTeam || !aTeam) return;

            const comp = compKey ? row[compKey] : 'Frauen-Bundesliga';
            const season = seasonKey ? row[seasonKey] : '2023/2024';
            const md = mdKey ? parseInt(row[mdKey]) || 1 : 1;
            const gh = ghKey ? parseInt(row[ghKey]) || 0 : 0;
            const ga = gaKey ? parseInt(row[gaKey]) || 0 : 0;
            const ph = phKey ? parseFloat(row[phKey]) || 50.0 : 50.0;
            const pa = paKey ? parseFloat(row[paKey]) || (100.0 - ph) : (100.0 - ph);

            // 1. Build Pairwise Match
            matches.push({
                competition: comp,
                season: season,
                matchday: md,
                team_home: hTeam,
                goals_home: gh,
                team_away: aTeam,
                goals_away: ga,
                possession_home: ph,
                possession_away: pa
            });

            // 2. Explode into Team-Game records (Home)
            teamGames.push({
                team: hTeam,
                opponent: aTeam,
                season: season,
                competition: comp,
                matchday: md,
                goals_for: gh,
                goals_against: ga,
                possession: ph,
                points: gh > ga ? 3 : (gh === ga ? 1 : 0)
            });

            // Explode into Team-Game records (Away)
            teamGames.push({
                team: aTeam,
                opponent: hTeam,
                season: season,
                competition: comp,
                matchday: md,
                goals_for: ga,
                goals_against: gh,
                possession: pa,
                points: ga > gh ? 3 : (gh === ga ? 1 : 0)
            });
        });

        NORMALIZED_DATA = teamGames;
        RECONSTRUCTED_MATCHES = matches;
    } else {
        // --- MODE B: TEAM-LEVEL CSV PROCESSING ---
        // Normal column normalization
        const norm = rawData.map(row => {
            const normRow = {};
            for (let key in row) {
                const val = row[key];
                const k = key.trim().toLowerCase();
                if (k === 'team' || k === 'mannschaft') {
                    normRow.team = val;
                } else if (k === 'saison' || k === 'season') {
                    normRow.season = val;
                } else if (k === 'competition' || k === 'liga' || k === 'wettbewerb') {
                    normRow.competition = val;
                } else if (k === 'spieltag' || k === 'matchday' || k === 'round' || k === 'runde') {
                    normRow.matchday = parseInt(val) || 1;
                } else if (k === 'tore' || k === 'goals' || k === 'goals_scored' || k === 'goals scored' || k === 'tore erzielt') {
                    normRow.goals_for = parseInt(val) || 0;
                } else if (k === 'gegentore' || k === 'conceded' || k === 'goals_conceded' || k === 'goals conceded' || k === 'tore kassiert') {
                    normRow.goals_against = parseInt(val) || 0;
                } else if (k === 'punkte' || k === 'points') {
                    normRow.points = parseInt(val) || 0;
                } else if (k === 'ballbesitz' || k === 'possession' || k === 'possession %' || k === 'ballbesitz %') {
                    normRow.possession = parseFloat(val) || 50.0;
                } else if (k === 'opponent' || k === 'gegner') {
                    normRow.opponent = val;
                } else {
                    normRow[key] = val;
                }
            }

            // Defaults
            if (!normRow.competition) normRow.competition = 'Frauen-Bundesliga';
            if (!normRow.season) normRow.season = '2023/2024';
            if (!normRow.matchday) normRow.matchday = 1;
            if (normRow.goals_for === undefined) normRow.goals_for = 0;
            if (normRow.goals_against === undefined) normRow.goals_against = 0;
            if (normRow.points === undefined) {
                normRow.points = normRow.goals_for > normRow.goals_against ? 3 : (normRow.goals_for === normRow.goals_against ? 1 : 0);
            }
            if (normRow.possession === undefined) normRow.possession = 50.0;

            return normRow;
        });

        NORMALIZED_DATA = norm;
        RECONSTRUCTED_MATCHES = reconstructMatchesFromTeamRecords(norm);
    }
}

function reconstructMatchesFromTeamRecords(df) {
    const sorted = [...df].sort((a, b) => {
        if (a.competition !== b.competition) return a.competition.localeCompare(b.competition);
        if (a.season !== b.season) return b.season.localeCompare(a.season);
        return a.matchday - b.matchday;
    });
    
    const matches = [];
    const seen = new Set();
    
    const firstRow = sorted[0];
    if (firstRow && firstRow.opponent !== undefined) {
        sorted.forEach(row => {
            const comp = row.competition;
            const season = row.season;
            const md = row.matchday;
            const t = row.team;
            const opp = row.opponent;
            
            const sorted_teams = [t, opp].sort();
            const matchKey = `${comp}_${season}_${md}_${sorted_teams[0]}_${sorted_teams[1]}`;
            
            if (!seen.has(matchKey)) {
                seen.add(matchKey);
                
                const oppRow = sorted.find(r => 
                    r.team === opp && 
                    r.season === season && 
                    r.competition === comp && 
                    r.matchday === md
                );
                
                if (oppRow) {
                    matches.push({
                        competition: comp,
                        season: season,
                        matchday: md,
                        team_home: t,
                        goals_home: row.goals_for,
                        team_away: opp,
                        goals_away: oppRow.goals_for,
                        possession_home: row.possession,
                        possession_away: oppRow.possession
                    });
                } else {
                    matches.push({
                        competition: comp,
                        season: season,
                        matchday: md,
                        team_home: t,
                        goals_home: row.goals_for,
                        team_away: opp,
                        goals_away: row.goals_against,
                        possession_home: row.possession,
                        possession_away: 100.0 - row.possession
                    });
                }
            }
        });
        return matches;
    }
    
    const grouped = {};
    sorted.forEach(row => {
        const key = `${row.competition}_${row.season}_${row.matchday}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
    });
    
    for (let key in grouped) {
        const group = grouped[key];
        const paired = new Set();
        
        group.forEach(row => {
            const t = row.team;
            if (paired.has(t)) return;
            
            const partner = group.find(r => 
                !paired.has(r.team) && 
                r.team !== t && 
                r.goals_for === row.goals_against && 
                r.goals_against === row.goals_for
            );
            
            if (partner) {
                matches.push({
                    competition: row.competition,
                    season: row.season,
                    matchday: row.matchday,
                    team_home: t,
                    goals_home: row.goals_for,
                    team_away: partner.team,
                    goals_away: partner.goals_for,
                    possession_home: row.possession,
                    possession_away: partner.possession
                });
                paired.add(t);
                paired.add(partner.team);
            } else {
                matches.push({
                    competition: row.competition,
                    season: row.season,
                    matchday: row.matchday,
                    team_home: t,
                    goals_home: row.goals_for,
                    team_away: `Gegner von ${t}`,
                    goals_away: row.goals_against,
                    possession_home: row.possession,
                    possession_away: 100.0 - row.possession
                });
                paired.add(t);
            }
        });
    }
    return matches;
}

// Calculate Standings
function calculateStandings(matches) {
    const table = {};
    matches.forEach(m => {
        const h = m.team_home;
        const a = m.team_away;
        const gh = m.goals_home;
        const ga = m.goals_away;
        
        [h, a].forEach(t => {
            if (!table[t]) {
                table[t] = { Team: t, Spiele: 0, S: 0, U: 0, N: 0, Tore: 0, Gegentore: 0, Punkte: 0 };
            }
        });
        
        table[h].Spiele++;
        table[h].Tore += gh;
        table[h].Gegentore += ga;
        
        table[a].Spiele++;
        table[a].Tore += ga;
        table[a].Gegentore += gh;
        
        if (gh > ga) {
            table[h].S++;
            table[h].Punkte += 3;
            table[a].N++;
        } else if (gh < ga) {
            table[a].S++;
            table[a].Punkte += 3;
            table[h].N++;
        } else {
            table[h].U++;
            table[h].Punkte += 1;
            table[a].U++;
            table[a].Punkte += 1;
        }
    });
    
    const list = Object.values(table);
    list.forEach(t => {
        t.Tordifferenz = t.Tore - t.Gegentore;
    });
    
    list.sort((a, b) => {
        if (a.Punkte !== b.Punkte) return b.Punkte - a.Punkte;
        if (a.Tordifferenz !== b.Tordifferenz) return b.Tordifferenz - a.Tordifferenz;
        return b.Tore - a.Tore;
    });
    
    return list;
}

// Chronological Elo calculations
function calculateEloHistory(matches) {
    if (matches.length === 0) return { history: {}, final: {} };
    
    const teams = new Set();
    matches.forEach(m => {
        teams.add(m.team_home);
        teams.add(m.team_away);
    });
    
    const currentElos = {};
    const eloHistory = {};
    
    teams.forEach(t => {
        currentElos[t] = 1000.0;
        eloHistory[t] = [[0, 1000.0]];
    });
    
    const sortedMatches = [...matches].sort((a, b) => a.matchday - b.matchday);
    const K = 32;
    
    sortedMatches.forEach(m => {
        const h = m.team_home;
        const a = m.team_away;
        const gh = m.goals_home;
        const ga = m.goals_away;
        const md = m.matchday;
        
        const r_h = currentElos[h];
        const r_a = currentElos[a];
        
        const e_h = 1.0 / (1.0 + Math.pow(10.0, (r_a - r_h) / 400.0));
        const e_a = 1.0 - e_h;
        
        let s_h = 0.5;
        let s_a = 0.5;
        if (gh > ga) { s_h = 1.0; s_a = 0.0; }
        else if (gh < ga) { s_h = 0.0; s_a = 1.0; }
        
        const goalDiff = Math.abs(gh - ga);
        let g_mult = 1.0;
        if (goalDiff === 2) g_mult = 1.5;
        else if (goalDiff > 2) g_mult = 1.75 + (goalDiff - 3) / 8.0;
        
        const diff_h = K * g_mult * (s_h - e_h);
        const diff_a = K * g_mult * (s_a - e_a);
        
        currentElos[h] += diff_h;
        currentElos[a] += diff_a;
        
        eloHistory[h].push([md, currentElos[h]]);
        eloHistory[a].push([md, currentElos[a]]);
    });
    
    return { history: eloHistory, final: currentElos };
}

// ----------------------------------------------------
// MODEL: MATHEMATICAL ML POISSON PREDICTION ENGINE
// ----------------------------------------------------
function factorial(n) {
    if (n === 0 || n === 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}

function poissonPDF(k, lambda) {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function predictMatchPoisson(homeTeam, awayTeam, historicalMatches, currentElos) {
    if (historicalMatches.length === 0) {
        return { pH: 0.33, pD: 0.33, pA: 0.33, xgH: 1.2, xgA: 1.2, score: "1:1", upset: 0.0 };
    }
    
    const homeGoals = historicalMatches.map(m => m.goals_home);
    const awayGoals = historicalMatches.map(m => m.goals_away);
    
    const leagueAvgHome = Math.max(homeGoals.reduce((a,b)=>a+b,0) / homeGoals.length || 1.5, 0.5);
    const leagueAvgAway = Math.max(awayGoals.reduce((a,b)=>a+b,0) / awayGoals.length || 1.2, 0.5);
    
    function getStats(team) {
        const hMatches = historicalMatches.filter(m => m.team_home === team);
        const aMatches = historicalMatches.filter(m => m.team_away === team);
        
        const scoredH = hMatches.reduce((a,b)=>a+b.goals_home,0);
        const concededH = hMatches.reduce((a,b)=>a+b.goals_away,0);
        const scoredA = aMatches.reduce((a,b)=>a+b.goals_away,0);
        const concededA = aMatches.reduce((a,b)=>a+b.goals_home,0);
        
        const sortedTeamMatches = historicalMatches.filter(m => 
            m.team_home === team || m.team_away === team
        ).sort((a,b)=>b.matchday - a.matchday).slice(0,5);
        
        const pts = sortedTeamMatches.map(m => {
            const isHome = m.team_home === team;
            const gh = m.goals_home;
            const ga = m.goals_away;
            if (gh === ga) return 1;
            if ((isHome && gh > ga) || (!isHome && ga > gh)) return 3;
            return 0;
        });
        
        const avgForm = pts.length > 0 ? pts.reduce((a,b)=>a+b,0) / pts.length : 1.0;
        
        return {
            avgScoredH: hMatches.length > 0 ? scoredH / hMatches.length : leagueAvgHome,
            avgConcededH: hMatches.length > 0 ? concededH / hMatches.length : leagueAvgAway,
            avgScoredA: aMatches.length > 0 ? scoredA / aMatches.length : leagueAvgAway,
            avgConcededA: aMatches.length > 0 ? concededA / aMatches.length : leagueAvgHome,
            form: avgForm
        };
    }
    
    const hStats = getStats(homeTeam);
    const aStats = getStats(awayTeam);
    
    const attH = (hStats.avgScoredH + 0.1) / leagueAvgHome;
    const defA = (aStats.avgConcededA + 0.1) / leagueAvgHome;
    const attA = (aStats.avgScoredA + 0.1) / leagueAvgAway;
    const defH = (hStats.avgConcededH + 0.1) / leagueAvgAway;
    
    let xgH = Math.max(attH * defA * leagueAvgHome, 0.1);
    let xgA = Math.max(attA * defH * leagueAvgAway, 0.1);
    
    const eloH = currentElos[homeTeam] || 1000.0;
    const eloA = currentElos[awayTeam] || 1000.0;
    const eloDiff = eloH - eloA;
    
    const eloMultH = Math.max(1.0 + (eloDiff / 800.0), 0.2);
    const eloMultA = Math.max(1.0 - (eloDiff / 800.0), 0.2);
    
    xgH = Math.max(xgH * eloMultH, 0.1);
    xgA = Math.max(xgA * eloMultA, 0.1);
    
    const formDiff = hStats.form - aStats.form;
    const formMultH = Math.max(1.0 + (formDiff * 0.1), 0.2);
    const formMultA = Math.max(1.0 - (formDiff * 0.1), 0.2);
    
    xgH = Math.max(xgH * formMultH, 0.1);
    xgA = Math.max(xgA * formMultA, 0.1);
    
    const limit = 7;
    let pH = 0.0, pD = 0.0, pA = 0.0;
    let maxProb = -1.0;
    let score = "1:1";
    
    for (let i = 0; i < limit; i++) {
        const pH_goal = poissonPDF(i, xgH);
        for (let j = 0; j < limit; j++) {
            const pA_goal = poissonPDF(j, xgA);
            const joint = pH_goal * pA_goal;
            
            if (i > j) pH += joint;
            else if (i < j) pA += joint;
            else pD += joint;
            
            if (joint > maxProb) {
                maxProb = joint;
                score = `${i}:${j}`;
            }
        }
    }
    
    const sum = pH + pD + pA;
    pH /= sum; pD /= sum; pA /= sum;
    
    const fav = Math.max(pH, pA);
    const upset = fav > 0.60 ? 1.0 - fav : pD + Math.min(pH, pA);
    
    return { pH, pD, pA, xgH, xgA, score, upset };
}

// ----------------------------------------------------
// MONTE CARLO SEASON SIMULATOR LOOP
// ----------------------------------------------------
function runMonteCarlo(playedMatches, teams, currentElos, numSims = 200) {
    const listTeams = Array.from(teams);
    let unplayed = getUnplayedMatches(listTeams, playedMatches);
    const simFromScratch = unplayed.length === 0;
    
    if (simFromScratch) {
        unplayed = [];
        listTeams.forEach(t1 => {
            listTeams.forEach(t2 => {
                if (t1 !== t2) unplayed.push([t1, t2]);
            });
        });
    }
    
    const matchOdds = {};
    unplayed.forEach(([h, a]) => {
        const res = predictMatchPoisson(h, a, playedMatches, currentElos);
        matchOdds[`${h}_${a}`] = [res.pH, res.pD, res.pA];
    });
    
    const tracker = {};
    listTeams.forEach(t => {
        tracker[t] = { first: 0, top3: 0, last: 0, points: 0, ranks: 0 };
    });
    
    for (let s = 0; s < numSims; s++) {
        const pts = {};
        listTeams.forEach(t => pts[t] = 0);
        
        if (!simFromScratch) {
            playedMatches.forEach(m => {
                const h = m.team_home; const a = m.team_away;
                const gh = m.goals_home; const ga = m.goals_away;
                if (gh > ga) pts[h] += 3;
                else if (gh < ga) pts[a] += 3;
                else { pts[h] += 1; pts[a] += 1; }
            });
        }
        
        unplayed.forEach(([h, a]) => {
            const [ph, pd, pa] = matchOdds[`${h}_${a}`];
            const r = Math.random();
            if (r < ph) pts[h] += 3;
            else if (r < ph + pd) { pts[h] += 1; pts[a] += 1; }
            else pts[a] += 3;
        });
        
        const sorted = Object.keys(pts).sort((a,b) => pts[b] - pts[a]);
        sorted.forEach((team, rIdx) => {
            tracker[team].points += pts[team];
            tracker[team].ranks += (rIdx + 1);
            if (rIdx === 0) tracker[team].first++;
            if (rIdx < 3) tracker[team].top3++;
            if (rIdx === sorted.length - 1) tracker[team].last++;
        });
    }
    
    const simTable = listTeams.map(t => {
        return {
            Team: t,
            avgPoints: tracker[t].points / numSims,
            avgRank: tracker[t].ranks / numSims,
            meister: (tracker[t].first / numSims) * 100,
            top3: (tracker[t].top3 / numSims) * 100,
            abstieg: (tracker[t].last / numSims) * 100
        };
    }).sort((a, b) => b.avgPoints - a.avgPoints);
    
    return { table: simTable, scratch: simFromScratch };
}

// ----------------------------------------------------
// INTERACTIVE STATE RENDER CONTROLLER
// ----------------------------------------------------
function initializeDashboard(rawData) {
    processUploadedData(rawData);
    
    // Toggle views
    onboardingContainer.classList.add('hidden');
    sectionNav.classList.remove('hidden');
    sectionFilters.classList.remove('hidden');
    btnReset.classList.remove('hidden');
    sidebarUploadBtn.classList.add('hidden');
    
    // Hide the upload section completely once data is loaded
    const sectionLoader = document.getElementById('section-loader');
    if (sectionLoader) sectionLoader.classList.add('hidden');
    
    populateFilters();
    changePage('Teams');
}

function populateFilters() {
    // Competitions
    const comps = Array.from(new Set(NORMALIZED_DATA.map(r => r.competition))).sort();
    selectCompetition.innerHTML = `<option value="Alle">Alle Ligen</option>` + comps.map(c => `<option value="${c}">${c}</option>`).join('');
    
    updateSeasonFilter();
}

selectCompetition.addEventListener('change', updateSeasonFilter);
selectSeason.addEventListener('change', updateTeamFilter);

// Toggle All Teams sidebar button logic
const btnToggleAllTeams = document.getElementById('btn-toggle-all-teams');
if (btnToggleAllTeams) {
    btnToggleAllTeams.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.team-checkbox');
        const checkedCount = document.querySelectorAll('.team-checkbox:checked').length;
        
        if (checkedCount > 0) {
            // Deselect ALL of them completely so the dashboard remains empty
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            btnToggleAllTeams.innerText = 'Alle auswählen';
        } else {
            // Select all
            checkboxes.forEach(cb => {
                cb.checked = true;
            });
            btnToggleAllTeams.innerText = 'Alle abwählen';
        }
        triggerRecompute();
    });
}

function updateToggleAllButtonText() {
    const btnToggleAll = document.getElementById('btn-toggle-all-teams');
    if (btnToggleAll) {
        const checkedCount = document.querySelectorAll('.team-checkbox:checked').length;
        if (checkedCount === 0) {
            btnToggleAll.innerText = 'Alle auswählen';
        } else {
            btnToggleAll.innerText = 'Alle abwählen';
        }
    }
}

function updateSeasonFilter() {
    const comp = selectCompetition.value;
    let subset = NORMALIZED_DATA;
    if (comp !== 'Alle') {
        subset = NORMALIZED_DATA.filter(r => r.competition === comp);
    }
    
    const seasons = Array.from(new Set(subset.map(r => r.season))).sort().reverse();
    selectSeason.innerHTML = seasons.map(s => `<option value="${s}">${s}</option>`).join('');
    
    updateTeamFilter();
}

function updateTeamFilter() {
    const comp = selectCompetition.value;
    const season = selectSeason.value;
    
    // Find all matches in this competition/season
    let matchSubset = RECONSTRUCTED_MATCHES.filter(m => m.season === season);
    if (comp !== 'Alle') {
        matchSubset = matchSubset.filter(m => m.competition === comp);
    }
    
    // Create unique team list from both home_team and away_team
    const teamsSet = new Set();
    matchSubset.forEach(m => {
        teamsSet.add(m.team_home);
        teamsSet.add(m.team_away);
    });
    
    const teams = Array.from(teamsSet).filter(t => t && !t.startsWith("Gegner von")).sort();
    
    // Draw checkboxes
    multiTeams.innerHTML = teams.map(t => `
        <label class="multi-select-item">
            <input type="checkbox" value="${t}" checked class="team-checkbox">
            <span>${t}</span>
        </label>
    `).join('');
    
    // Bind listeners
    document.querySelectorAll('.team-checkbox').forEach(cb => {
        cb.addEventListener('change', handleTeamCheckboxChange);
    });
    
    updateToggleAllButtonText();
    
    triggerRecompute();
}

function handleTeamCheckboxChange() {
    // Allows empty checkbox states per user request
    updateToggleAllButtonText();
    triggerRecompute();
}

function triggerRecompute() {
    const comp = selectCompetition.value;
    const season = selectSeason.value;
    
    // Selected team keys
    const selected = Array.from(document.querySelectorAll('.team-checkbox:checked')).map(cb => cb.value);
    
    // Filter matches and Elo calculations (unfiltered by teams for overall ML models, but filtered by league/season)
    let subsetMatches = RECONSTRUCTED_MATCHES.filter(m => m.season === season);
    if (comp !== 'Alle') subsetMatches = subsetMatches.filter(m => m.competition === comp);
    
    const eloRes = calculateEloHistory(subsetMatches);
    ELO_HISTORY = eloRes.history;
    FINAL_ELOS = eloRes.final;
    
    // Filter team data games strictly by selected teams (dashboard empty if selected is empty)
    let teamSubset = NORMALIZED_DATA.filter(r => r.season === season);
    if (comp !== 'Alle') teamSubset = teamSubset.filter(r => r.competition === comp);
    teamSubset = teamSubset.filter(r => selected.includes(r.team));
    
    renderViews(teamSubset, selected, subsetMatches);
}

function populateTableDropdown(selectId, key, label, data, currentValue) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Get unique values for this key, sorted
    const values = Array.from(new Set(data.map(row => row[key])))
        .sort((a, b) => {
            if (typeof a === 'number' && typeof b === 'number') return a - b;
            return String(a).localeCompare(String(b), undefined, {numeric: true});
        });
        
    // Generate HTML
    let html = `<option value="Alle">Alle (${label})</option>`;
    values.forEach(val => {
        const selectedAttr = (String(val) === String(currentValue)) ? 'selected' : '';
        html += `<option value="${val}" ${selectedAttr}>${val}</option>`;
    });
    
    select.innerHTML = html;
}

function renderViews(teamData, selectedTeams, currentCompSeasonMatches) {
    // Render KPI indicators based on selected categories (using OR filter so single-team selection works correctly)
    const filteredMatches = currentCompSeasonMatches.filter(m => 
        selectedTeams.includes(m.team_home) || selectedTeams.includes(m.team_away)
    );
    const matchesCnt = filteredMatches.length;
    
    // Calculate total goals scored by the selected teams
    const totalGoals = teamData.reduce((sum, r) => sum + r.goals_for, 0);
    
    const avgGoals = matchesCnt > 0 ? (totalGoals / matchesCnt).toFixed(2) : "0.00";
    const numTeams = selectedTeams.length;
    
    document.getElementById('kpi-total-matches').innerText = `🏟️ ${matchesCnt}`;
    document.getElementById('kpi-total-goals').innerText = `⚽ ${totalGoals}`;
    document.getElementById('kpi-avg-goals').innerText = `📈 ${avgGoals}`;
    document.getElementById('kpi-num-teams').innerText = `👥 ${numTeams}`;
    
    // Line Chart Team Select Population
    const lineTeamSelect = document.getElementById('select-line-team');
    const oldLineTeam = lineTeamSelect.value;
    lineTeamSelect.innerHTML = selectedTeams.map(t => `<option value="${t}">${t}</option>`).join('');
    if (oldLineTeam && selectedTeams.includes(oldLineTeam)) {
        lineTeamSelect.value = oldLineTeam;
    } else if (selectedTeams.length > 0) {
        lineTeamSelect.value = selectedTeams[0];
    }
    
    // Bind Line Team Select change
    lineTeamSelect.onchange = () => drawLineChart(teamData);
    
    // Redraw charts
    drawCharts(teamData);
    drawLineChart(teamData);
    
    // Get current selections of dropdown filters
    const selTeam = document.getElementById('search-col-team')?.value || 'Alle';
    const selOpponent = document.getElementById('search-col-opponent')?.value || 'Alle';
    const selGoalsFor = document.getElementById('search-col-goals-for')?.value || 'Alle';
    const selGoalsAgainst = document.getElementById('search-col-goals-against')?.value || 'Alle';
    const selMatchday = document.getElementById('search-col-matchday')?.value || 'Alle';
    
    // Populate dropdowns with current teamData values
    populateTableDropdown('search-col-team', 'team', 'Teams', teamData, selTeam);
    populateTableDropdown('search-col-opponent', 'opponent', 'Gegner', teamData, selOpponent);
    populateTableDropdown('search-col-goals-for', 'goals_for', 'Tore', teamData, selGoalsFor);
    populateTableDropdown('search-col-goals-against', 'goals_against', 'Gegentore', teamData, selGoalsAgainst);
    populateTableDropdown('search-col-matchday', 'matchday', 'Spieltage', teamData, selMatchday);
    
    // Data Table with Column-specific dropdown filters
    renderRawDataTable(teamData);
    
    // Bind table dropdown filter change events
    ['search-col-team', 'search-col-opponent', 'search-col-goals-for', 'search-col-goals-against', 'search-col-matchday'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.onchange = () => renderRawDataTable(teamData);
        }
    });
    
    // Populate Matches Page Matchday Filter Dropdown
    const matchesMatchdaySelect = document.getElementById('select-matches-matchday');
    if (matchesMatchdaySelect) {
        const selMatchesMatchday = matchesMatchdaySelect.value || 'Alle';
        const uniqueMatchdays = Array.from(new Set(currentCompSeasonMatches.map(m => m.matchday)))
            .sort((a, b) => a - b);
            
        let selectHtml = `<option value="Alle">Alle Spieltage</option>`;
        uniqueMatchdays.forEach(md => {
            const selectedAttr = (String(md) === String(selMatchesMatchday)) ? 'selected' : '';
            selectHtml += `<option value="${md}" ${selectedAttr}>Spieltag ${md}</option>`;
        });
        matchesMatchdaySelect.innerHTML = selectHtml;
        matchesMatchdaySelect.onchange = () => triggerRecompute();
    }
    
    const activeMatchesMatchday = document.getElementById('select-matches-matchday')?.value || 'Alle';
    let renderedMatches = filteredMatches;
    if (activeMatchesMatchday !== 'Alle') {
        renderedMatches = filteredMatches.filter(m => String(m.matchday) === activeMatchesMatchday);
    }
    
    // Matches Page Table (filtered by active selected teams & Spieltag dropdown)
    document.getElementById('table-reconstructed-matches').innerHTML = renderedMatches.map(m => `
        <tr>
            <td>${m.matchday}</td>
            <td>${m.team_home}</td>
            <td style="text-align:center; font-weight:800;">${m.goals_home} : ${m.goals_away}</td>
            <td>${m.team_away}</td>
        </tr>
    `).join('');
    
    // Populate Stats Page Matchday Filter Dropdown
    const statsMatchdaySelect = document.getElementById('select-stats-matchday');
    if (statsMatchdaySelect) {
        const selStatsMatchday = statsMatchdaySelect.value || 'Alle';
        const uniqueMatchdays = Array.from(new Set(currentCompSeasonMatches.map(m => m.matchday)))
            .sort((a, b) => a - b);
            
        let selectHtml = `<option value="Alle">Alle Spieltage</option>`;
        uniqueMatchdays.forEach(md => {
            const selectedAttr = (String(md) === String(selStatsMatchday)) ? 'selected' : '';
            selectHtml += `<option value="${md}" ${selectedAttr}>Spieltag ${md}</option>`;
        });
        statsMatchdaySelect.innerHTML = selectHtml;
        statsMatchdaySelect.onchange = () => triggerRecompute();
    }
    
    const activeStatsMatchday = document.getElementById('select-stats-matchday')?.value || 'Alle';
    let standingsMatches = currentCompSeasonMatches;
    if (activeStatsMatchday !== 'Alle') {
        const limit = parseInt(activeStatsMatchday);
        standingsMatches = currentCompSeasonMatches.filter(m => m.matchday <= limit);
    }
    
    // Standings league table (filtered up to the active Stats Spieltag dropdown limit)
    const standings = calculateStandings(standingsMatches);
    document.getElementById('table-standings').innerHTML = standings.map((s, idx) => `
        <tr>
            <td>${idx+1}</td>
            <td style="font-weight:700; color:var(--primary);">${s.Team}</td>
            <td>${s.Spiele}</td>
            <td>${s.S}</td>
            <td>${s.U}</td>
            <td>${s.N}</td>
            <td>${s.Tore}:${s.Gegentore}</td>
            <td>${s.Tordifferenz > 0 ? '+' + s.Tordifferenz : s.Tordifferenz}</td>
            <td style="font-weight:800; color:var(--primary);">${s.Punkte}</td>
        </tr>
    `).join('');
    
    // Distributions removed per user request
    
    // Render ML
    setupMLPageOptions(currentCompSeasonMatches);
}

function drawCharts(teamData) {
    if (teamData.length === 0) return;
    
    const barMetric = document.getElementById('select-bar-metric').value;
    if (!barMetric) return;
    
    // Sum by team
    const barAgg = {};
    teamData.forEach(row => {
        if (!barAgg[row.team]) barAgg[row.team] = 0;
        barAgg[row.team] += row[barMetric];
    });
    
    // Sort Ascending
    const sortedTeams = Object.keys(barAgg).sort((a, b) => barAgg[a] - barAgg[b]);
    const sortedValues = sortedTeams.map(t => barAgg[t]);
    
    const barTrace = {
        x: sortedTeams,
        y: sortedValues,
        type: 'bar',
        marker: { color: barMetric === 'goals_for' ? '#8b5cf6' : '#ec4899' } // Purple / Rose (No Blue/Green)
    };
    
    const barLayout = {
        margin: { t: 40, b: 100, l: 60, r: 20 },
        xaxis: { 
            title: { text: 'Mannschaft', standoff: 20 },
            tickangle: -45,
            automargin: true
        },
        yaxis: { 
            title: { text: barMetric === 'goals_for' ? 'Tore erzielt' : 'Gegentore', standoff: 15 },
            automargin: true
        }
    };
    
    Plotly.newPlot('chart-bar', [barTrace], barLayout, {responsive: true, displayModeBar: false});
}

function drawLineChart(teamData) {
    const selectedTeam = document.getElementById('select-line-team').value;
    if (!selectedTeam) return;
    
    // Filter matches for this team, sorted by matchday ascending
    const subset = teamData.filter(r => r.team === selectedTeam).sort((a, b) => a.matchday - b.matchday);
    
    let winsAcc = 0;
    let lossesAcc = 0;
    
    const xMatchdays = [];
    const yWins = [];
    const yLosses = [];
    
    subset.forEach(r => {
        if (r.points === 3) winsAcc++;
        if (r.points === 0) lossesAcc++;
        
        xMatchdays.push(r.matchday);
        yWins.push(winsAcc);
        yLosses.push(lossesAcc);
    });
    
    const traceWins = {
        x: xMatchdays,
        y: yWins,
        mode: 'lines+markers',
        name: 'Kumulierte Siege',
        line: { color: '#ec4899', width: 3 }, // Rose (No Blue/Green)
        marker: { size: 6 }
    };
    
    const traceLosses = {
        x: xMatchdays,
        y: yLosses,
        mode: 'lines+markers',
        name: 'Kumulierte Niederlagen',
        line: { color: '#8b5cf6', width: 3 }, // Purple (No Blue/Green)
        marker: { size: 6 }
    };
    
    const layout = {
        margin: { t: 40, b: 60, l: 60, r: 20 },
        xaxis: { 
            title: { text: 'Spieltag', standoff: 15 }, 
            tickmode: 'linear', 
            dtick: 1, 
            automargin: true 
        },
        yaxis: { 
            title: { text: 'Anzahl (kumuliert)', standoff: 15 },
            automargin: true 
        },
        legend: { orientation: 'h', y: -0.25 }
    };
    
    Plotly.newPlot('chart-line', [traceWins, traceLosses], layout, {responsive: true, displayModeBar: false});
}

function renderRawDataTable(teamData) {
    const qTeam = document.getElementById('search-col-team').value;
    const qOpponent = document.getElementById('search-col-opponent').value;
    const qGoalsFor = document.getElementById('search-col-goals-for').value;
    const qGoalsAgainst = document.getElementById('search-col-goals-against').value;
    const qMatchday = document.getElementById('search-col-matchday').value;
    
    const filtered = teamData.filter(row => {
        if (qTeam && qTeam !== 'Alle' && String(row.team) !== qTeam) return false;
        if (qOpponent && qOpponent !== 'Alle' && String(row.opponent) !== qOpponent) return false;
        if (qGoalsFor && qGoalsFor !== 'Alle' && String(row.goals_for) !== qGoalsFor) return false;
        if (qGoalsAgainst && qGoalsAgainst !== 'Alle' && String(row.goals_against) !== qGoalsAgainst) return false;
        if (qMatchday && qMatchday !== 'Alle' && String(row.matchday) !== qMatchday) return false;
        return true;
    });
    
    const displayHeaders = ['Team', 'Gegner', 'Tore', 'Gegentore', 'Spieltag', 'Saison', 'Liga'];
    document.getElementById('table-raw-headers').innerHTML = displayHeaders.map(h => `<th>${h}</th>`).join('');
    
    document.getElementById('table-raw-body').innerHTML = filtered.map(row => `
        <tr>
            <td style="font-weight:700;">${row.team}</td>
            <td>${row.opponent}</td>
            <td style="font-weight:700; color:var(--primary);">${row.goals_for}</td>
            <td style="color:var(--danger);">${row.goals_against}</td>
            <td>${row.matchday}</td>
            <td style="font-size:0.75rem; color:var(--slate-400);">${row.season}</td>
            <td style="font-size:0.75rem; color:var(--slate-400);">${row.competition}</td>
        </tr>
    `).join('');
}

// drawDistCharts has been removed per user request

// Chart selectors update
document.getElementById('select-bar-metric').addEventListener('change', () => {
    const cb = document.querySelectorAll('.team-checkbox:checked');
    const selected = Array.from(cb).map(c => c.value);
    const season = selectSeason.value;
    const comp = selectCompetition.value;
    let subset = NORMALIZED_DATA.filter(r => r.season === season && selected.includes(r.team));
    if (comp !== 'Alle') subset = subset.filter(r => r.competition === comp);
    drawCharts(subset);
});

// ----------------------------------------------------
// MACHINE LEARNING ENGINE CONTROLS
// ----------------------------------------------------
const selectPredHome = document.getElementById('select-pred-home');
const selectPredAway = document.getElementById('select-pred-away');
const selectEloT1 = document.getElementById('select-elo-t1');
const selectEloT2 = document.getElementById('select-elo-t2');
const selectMlDetailTeam = document.getElementById('select-ml-detail-team');

let CURRENT_ML_MATCHES = [];

function setupMLPageOptions(compSeasonMatches) {
    CURRENT_ML_MATCHES = compSeasonMatches;
    
    const teams = Object.keys(FINAL_ELOS).sort();
    if (teams.length === 0) return;
    
    const opts = teams.map(t => `<option value="${t}">${t}</option>`).join('');
    
    const oldH = selectPredHome.value;
    const oldA = selectPredAway.value;
    const oldT1 = selectEloT1.value;
    const oldT2 = selectEloT2.value;
    const oldDet = selectMlDetailTeam.value;
    
    selectPredHome.innerHTML = opts;
    selectPredAway.innerHTML = opts;
    selectEloT1.innerHTML = opts;
    selectEloT2.innerHTML = opts;
    selectMlDetailTeam.innerHTML = opts;
    
    if (oldH && teams.includes(oldH)) selectPredHome.value = oldH;
    else selectPredHome.value = teams[0];
    
    if (oldA && teams.includes(oldA)) selectPredAway.value = oldA;
    else selectPredAway.value = teams[1] || teams[0];
    
    if (oldT1 && teams.includes(oldT1)) selectEloT1.value = oldT1;
    else selectEloT1.value = teams[0];
    
    if (oldT2 && teams.includes(oldT2)) selectEloT2.value = oldT2;
    else selectEloT2.value = teams[1] || teams[0];
    
    if (oldDet && teams.includes(oldDet)) selectMlDetailTeam.value = oldDet;
    else selectMlDetailTeam.value = teams[0];
    
    calculatePrediction();
    drawEloHistoryChart();
    renderDetailAnalyses();
    calculateExpectedPoints();
}

selectPredHome.addEventListener('change', (e) => {
    if (e.target.value === selectPredAway.value) {
        const fallback = Object.keys(FINAL_ELOS).find(t => t !== e.target.value);
        if (fallback) selectPredAway.value = fallback;
    }
    calculatePrediction();
});

selectPredAway.addEventListener('change', (e) => {
    if (e.target.value === selectPredHome.value) {
        const fallback = Object.keys(FINAL_ELOS).find(t => t !== e.target.value);
        if (fallback) selectPredHome.value = fallback;
    }
    calculatePrediction();
});

selectEloT1.addEventListener('change', drawEloHistoryChart);
selectEloT2.addEventListener('change', drawEloHistoryChart);
selectMlDetailTeam.addEventListener('change', renderDetailAnalyses);

function calculatePrediction() {
    const h = selectPredHome.value;
    const a = selectPredAway.value;
    
    if (!h || !a || h === a) return;
    
    const res = predictMatchPoisson(h, a, CURRENT_ML_MATCHES, FINAL_ELOS);
    
    const outputDiv = document.getElementById('ml-prediction-output');
    if (outputDiv) outputDiv.classList.remove('hidden');
    
    const phBar = document.getElementById('prob-bar-home');
    const pdBar = document.getElementById('prob-bar-draw');
    const paBar = document.getElementById('prob-bar-away');
    
    if (phBar && pdBar && paBar) {
        phBar.style.width = `${res.pH * 100}%`;
        phBar.innerText = `${(res.pH * 100).toFixed(0)}%`;
        
        pdBar.style.width = `${res.pD * 100}%`;
        pdBar.innerText = `${(res.pD * 100).toFixed(0)}%`;
        
        paBar.style.width = `${res.pA * 100}%`;
        paBar.innerText = `${(res.pA * 100).toFixed(0)}%`;
    }
    
    const lblHome = document.getElementById('label-prob-home');
    const lblDraw = document.getElementById('label-prob-draw');
    const lblAway = document.getElementById('label-prob-away');
    
    if (lblHome) lblHome.innerText = `🏆 Sieg ${h}: ${(res.pH*100).toFixed(1)}%`;
    if (lblDraw) lblDraw.innerText = `🤝 Unentschieden: ${(res.pD*100).toFixed(1)}%`;
    if (lblAway) lblAway.innerText = `🚀 Sieg ${a}: ${(res.pA*100).toFixed(1)}%`;
    
    const xgHVal = document.getElementById('pred-xg-home');
    const xgAVal = document.getElementById('pred-xg-away');
    const scoreVal = document.getElementById('pred-score-result');
    const upsetVal = document.getElementById('pred-upset-prob');
    
    if (xgHVal) xgHVal.innerText = `⚽ ${res.xgH.toFixed(2)}`;
    if (xgAVal) xgAVal.innerText = `⚽ ${res.xgA.toFixed(2)}`;
    if (scoreVal) scoreVal.innerText = `📊 ${res.score}`;
    if (upsetVal) upsetVal.innerText = `${(res.upset*100).toFixed(1)}% Risiko einer Überraschung (Draw oder Underdog-Sieg).`;
}

function drawEloHistoryChart() {
    const t1 = selectEloT1.value;
    const t2 = selectEloT2.value;
    
    if (!t1 || !t2 || !ELO_HISTORY[t1] || !ELO_HISTORY[t2]) return;
    
    const list = Object.keys(FINAL_ELOS).map(t => {
        return { Team: t, Elo: FINAL_ELOS[t] };
    }).sort((a,b)=>b.Elo - a.Elo);
    
    document.getElementById('table-elo-standings').innerHTML = list.map((item, r) => `
        <tr>
            <td>${r+1}</td>
            <td style="font-weight:700;">${item.Team}</td>
            <td style="font-weight:800; color:var(--primary);">${item.Elo.toFixed(1)}</td>
        </tr>
    `).join('');
    
    const h1 = ELO_HISTORY[t1];
    const h2 = ELO_HISTORY[t2];
    
    const trace1 = {
        x: h1.map(item => item[0]),
        y: h1.map(item => item[1]),
        mode: 'lines+markers',
        name: t1,
        line: { color: '#8b5cf6', width: 3 } // Purple
    };
    
    const trace2 = {
        x: h2.map(item => item[0]),
        y: h2.map(item => item[1]),
        mode: 'lines+markers',
        name: t2,
        line: { color: '#ec4899', width: 3 } // Rose
    };
    
    const layout = {
        margin: { t: 10, b: 35, l: 40, r: 15 },
        xaxis: { title: 'Spieltag' },
        yaxis: { title: 'Elo' }
    };
    
    Plotly.newPlot('chart-elo-history', [trace1, trace2], layout, {responsive: true, displayModeBar: false});
}

function renderDetailAnalyses() {
    const t = selectMlDetailTeam.value;
    if (!t) return;
    
    const last5 = CURRENT_ML_MATCHES.filter(m => 
        m.team_home === t || m.team_away === t
    ).sort((a,b)=>b.matchday - a.matchday).slice(0,5);
    
    const badgesHTML = last5.map(m => {
        const isHome = m.team_home === t;
        const gh = m.goals_home;
        const ga = m.goals_away;
        
        if (gh === ga) {
            return `<span class="form-badge badge-draw">U</span>`;
        } else if ((isHome && gh > ga) || (!isHome && ga > gh)) {
            return `<span class="form-badge badge-win">S</span>`;
        } else {
            return `<span class="form-badge badge-loss">N</span>`;
        }
    }).join('');
    
    document.getElementById('formkurve-badges').innerHTML = badgesHTML || `<span style="font-size:0.8rem; color:var(--slate-400);">Keine Matches</span>`;
}

function calculateExpectedPoints() {
    const teams = Object.keys(FINAL_ELOS);
    if (teams.length === 0) return;
    
    const xpts = {};
    const matches = {};
    
    teams.forEach(t => { xpts[t] = 0.0; matches[t] = 0; });
    
    CURRENT_ML_MATCHES.forEach(m => {
        const h = m.team_home; const a = m.team_away;
        const res = predictMatchPoisson(h, a, CURRENT_ML_MATCHES, FINAL_ELOS);
        
        xpts[h] += 3.0 * res.pH + 1.0 * res.pD;
        xpts[a] += 3.0 * res.pA + 1.0 * res.pD;
        matches[h]++;
        matches[a]++;
    });
    
    const standings = calculateStandings(CURRENT_ML_MATCHES);
    
    const xptsList = teams.map(t => {
        const sRow = standings.find(s => s.Team === t);
        const actual = sRow ? sRow.Punkte : 0;
        return {
            Team: t,
            Spiele: matches[t],
            xPTS: xpts[t],
            actual: actual,
            diff: actual - xpts[t]
        };
    }).sort((a,b) => b.xPTS - a.xPTS);
    
    document.getElementById('table-xpts').innerHTML = xptsList.map((item, idx) => `
        <tr>
            <td>${idx+1}</td>
            <td style="font-weight:700;">${item.Team}</td>
            <td>${item.Spiele}</td>
            <td style="font-weight:800; color:var(--primary);">${item.xPTS.toFixed(1)}</td>
            <td style="font-weight:700;">${item.actual}</td>
            <td style="font-weight:700; color:${item.diff >= 0 ? 'var(--success)' : 'var(--danger)'};">${item.diff >= 0 ? '+' : ''}${item.diff.toFixed(1)}</td>
        </tr>
    `).join('');
}

// Monte Carlo Trigger
const btnSim = document.getElementById('btn-run-simulation');
if (btnSim) {
    btnSim.addEventListener('click', () => {
        const listTeams = Object.keys(FINAL_ELOS);
        if (listTeams.length === 0) return;
        
        btnSim.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> Berechne Simulationen...`;
        lucide.createIcons();
        
        setTimeout(() => {
            const res = runMonteCarlo(CURRENT_ML_MATCHES, listTeams, FINAL_ELOS, 200);
            
            document.getElementById('sim-results-container').classList.remove('hidden');
            
            if (res.scratch) {
                document.getElementById('sim-status-title').innerText = "Vollständige Saisonsimulation";
                document.getElementById('sim-status-desc').innerText = "Die Saison ist beendet. Die Simulation zeigt den theoretischen Verlauf einer kompletten Saison aus einer Null-Basis.";
            } else {
                document.getElementById('sim-status-title').innerText = "Saisonprognose (Restspiele simuliert)";
                document.getElementById('sim-status-desc').innerText = "Berechnet aus den tatsächlichen Punkten bereits gespielter Spiele plus 200 statistisch simulierter Restspiele.";
            }
            
            document.getElementById('table-simulation-results').innerHTML = res.table.map((item, idx) => `
                <tr>
                    <td>${idx+1}</td>
                    <td style="font-weight:700; color:var(--primary);">${item.Team}</td>
                    <td>${item.avgPoints.toFixed(1)}</td>
                    <td>${item.avgRank.toFixed(1)}</td>
                    <td style="font-weight:800; color:var(--primary);">${item.meister.toFixed(1)}%</td>
                    <td style="font-weight:700; color:var(--success);">${item.top3.toFixed(1)}%</td>
                    <td style="font-weight:700; color:var(--danger);">${item.abstieg.toFixed(1)}%</td>
                </tr>
            `).join('');
            
            btnSim.innerHTML = `<i data-lucide="play"></i> Monte-Carlo-Simulation erneut starten (200 Durchläufe)`;
            lucide.createIcons();
        }, 300);
    });
}

// ----------------------------------------------------
// NAVIGATION & ROUTING CONTROLLER
// ----------------------------------------------------
function changePage(pageId) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.dashboard-view').forEach(view => view.classList.remove('active'));
    
    const activeBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const targetView = document.getElementById(`view-${pageId.replace(' ', '-')}`);
    if (targetView) targetView.classList.add('active');
    
    const pageTitleMap = {
        "Teams": "Übersicht",
        "Matches": "Spiele",
        "Stats": "Tabelle",
        "Machine Learning": "Machine Learning"
    };
    document.getElementById('top-nav-title').innerText = `⚽ ${pageTitleMap[pageId] || pageId} Dashboard`;
    
    // Redraw charts
    const selected = Array.from(document.querySelectorAll('.team-checkbox:checked')).map(c => c.value);
    const season = selectSeason.value;
    const comp = selectCompetition.value;
    
    let subset = NORMALIZED_DATA.filter(r => r.season === season && selected.includes(r.team));
    if (comp !== 'Alle') subset = subset.filter(r => r.competition === comp);
    
    drawCharts(subset);
    
    // Distributions charts removed
    
    if (pageId === "Machine Learning") {
        drawEloHistoryChart();
    }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const pageId = e.currentTarget.getAttribute('data-page');
        changePage(pageId);
    });
});

// ML sub tabs triggers
document.querySelectorAll('.tab-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.getAttribute('data-tab');
        
        document.querySelectorAll('.tab-trigger').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.ml-tab-content').forEach(c => c.classList.remove('active'));
        
        e.currentTarget.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
        
        if (targetTab === "ml-tab-elo") {
            drawEloHistoryChart();
        }
    });
});

// ----------------------------------------------------
// SYSTEM RESET CONTROL
// ----------------------------------------------------
function resetDashboard() {
    RAW_DATA = [];
    NORMALIZED_DATA = [];
    RECONSTRUCTED_MATCHES = [];
    ELO_HISTORY = {};
    FINAL_ELOS = {};
    
    onboardingContainer.classList.remove('hidden');
    sectionNav.classList.add('hidden');
    sectionFilters.classList.add('hidden');
    btnReset.classList.add('hidden');
    sidebarUploadBtn.classList.remove('hidden');
    
    // Show the upload section again on reset
    const sectionLoader = document.getElementById('section-loader');
    if (sectionLoader) sectionLoader.classList.remove('hidden');
    
    document.querySelectorAll('.dashboard-view').forEach(view => view.classList.remove('active'));
    document.getElementById('top-nav-title').innerText = "⚽ Frauenfußball Performance Dashboard";
    
    onboardingFileInput.value = '';
    sidebarFileInput.value = '';
}

// Auto-run icons
lucide.createIcons();

const DEFAULT_CSV_DATA = `Team,Saison,Spieltag,Tore,Gegentore,Punkte,Ballbesitz
VfL Wolfsburg,2023/2024,1,3,0,3,62.5
VfL Wolfsburg,2023/2024,2,2,1,3,58.0
VfL Wolfsburg,2023/2024,3,4,0,3,65.2
FC Bayern München,2023/2024,1,2,0,3,60.1
FC Bayern München,2023/2024,2,1,1,1,55.4
FC Bayern München,2023/2024,3,3,1,3,59.8
Eintracht Frankfurt,2023/2024,1,1,2,0,48.5
Eintracht Frankfurt,2023/2024,2,2,0,3,51.2
Eintracht Frankfurt,2023/2024,3,1,1,1,49.9
TSG Hoffenheim,2023/2024,1,0,3,0,45.0
TSG Hoffenheim,2023/2024,2,1,2,0,42.5
TSG Hoffenheim,2023/2024,3,2,1,3,47.8
VfL Wolfsburg,2022/2023,1,4,1,3,64.0
VfL Wolfsburg,2022/2023,2,3,0,3,61.5
FC Bayern München,2022/2023,1,3,0,3,62.0
FC Bayern München,2022/2023,2,2,1,3,58.5`;

// Automatically load default embedded dataset on boot
document.addEventListener('DOMContentLoaded', () => {
    const rows = parseCSVText(DEFAULT_CSV_DATA);
    if (rows && rows.length > 0) {
        RAW_DATA = rows;
        initializeDashboard(rows);
    }
});
