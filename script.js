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
            try {
                localStorage.setItem('womens_football_csv_data', text);
            } catch (err) {
                console.warn('LocalStorage-Limit überschritten oder nicht erlaubt:', err);
            }
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
    
    try {
        localStorage.removeItem('womens_football_csv_data');
    } catch (err) {
        console.warn('Fehler beim Löschen der CSV aus localStorage:', err);
    }
    
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

const DEFAULT_CSV_DATA = `﻿date;home_team;away_team;home_goals;away_goals;matchday;competition;season
30.08.24;Turbine Potsdam;Bayern München;0;2;1;Google Pixel Frauen-Bundesliga;2024/2025
31.08.24;Eintracht Frankfurt;FC Carl Zeiss Jena;2;0;1;Google Pixel Frauen-Bundesliga;2024/2025
01.09.24;SGS Essen;1899 Hoffenheim;1;2;1;Google Pixel Frauen-Bundesliga;2024/2025
01.09.24;RB Leipzig;1. FC Köln;2;1;1;Google Pixel Frauen-Bundesliga;2024/2025
02.09.24;VfL Wolfsburg;Werder Bremen;3;3;1;Google Pixel Frauen-Bundesliga;2024/2025
26.01.25;SC Freiburg;Bayer Leverkusen;1;2;1;Google Pixel Frauen-Bundesliga;2024/2025
13.09.24;Bayern München;RB Leipzig;6;2;2;Google Pixel Frauen-Bundesliga;2024/2025
14.09.24;FC Carl Zeiss Jena;VfL Wolfsburg;0;1;2;Google Pixel Frauen-Bundesliga;2024/2025
14.09.24;Werder Bremen;Turbine Potsdam;2;0;2;Google Pixel Frauen-Bundesliga;2024/2025
15.09.24;Bayer Leverkusen;Eintracht Frankfurt;2;2;2;Google Pixel Frauen-Bundesliga;2024/2025
15.09.24;1. FC Köln;SGS Essen;2;2;2;Google Pixel Frauen-Bundesliga;2024/2025
16.09.24;1899 Hoffenheim;SC Freiburg;2;3;2;Google Pixel Frauen-Bundesliga;2024/2025
20.09.24;RB Leipzig;Werder Bremen;2;0;3;Google Pixel Frauen-Bundesliga;2024/2025
21.09.24;SC Freiburg;FC Carl Zeiss Jena;1;1;3;Google Pixel Frauen-Bundesliga;2024/2025
21.09.24;SGS Essen;Bayer Leverkusen;0;2;3;Google Pixel Frauen-Bundesliga;2024/2025
22.09.24;Turbine Potsdam;Eintracht Frankfurt;0;6;3;Google Pixel Frauen-Bundesliga;2024/2025
22.09.24;VfL Wolfsburg;1. FC Köln;5;1;3;Google Pixel Frauen-Bundesliga;2024/2025
23.09.24;Bayern München;1899 Hoffenheim;5;1;3;Google Pixel Frauen-Bundesliga;2024/2025
27.09.24;Bayer Leverkusen;1899 Hoffenheim;2;1;4;Google Pixel Frauen-Bundesliga;2024/2025
28.09.24;1. FC Köln;SC Freiburg;0;2;4;Google Pixel Frauen-Bundesliga;2024/2025
28.09.24;Turbine Potsdam;RB Leipzig;0;3;4;Google Pixel Frauen-Bundesliga;2024/2025
29.09.24;Werder Bremen;Bayern München;0;4;4;Google Pixel Frauen-Bundesliga;2024/2025
29.09.24;Eintracht Frankfurt;VfL Wolfsburg;3;0;4;Google Pixel Frauen-Bundesliga;2024/2025
30.09.24;FC Carl Zeiss Jena;SGS Essen;0;2;4;Google Pixel Frauen-Bundesliga;2024/2025
04.10.24;VfL Wolfsburg;RB Leipzig;5;0;5;Google Pixel Frauen-Bundesliga;2024/2025
05.10.24;SC Freiburg;Turbine Potsdam;3;0;5;Google Pixel Frauen-Bundesliga;2024/2025
05.10.24;Bayern München;1. FC Köln;1;0;5;Google Pixel Frauen-Bundesliga;2024/2025
06.10.24;SGS Essen;Eintracht Frankfurt;1;3;5;Google Pixel Frauen-Bundesliga;2024/2025
06.10.24;1899 Hoffenheim;Werder Bremen;1;0;5;Google Pixel Frauen-Bundesliga;2024/2025
07.10.24;Bayer Leverkusen;FC Carl Zeiss Jena;1;0;5;Google Pixel Frauen-Bundesliga;2024/2025
11.10.24;Turbine Potsdam;SGS Essen;0;3;6;Google Pixel Frauen-Bundesliga;2024/2025
12.10.24;Werder Bremen;Bayer Leverkusen;1;1;6;Google Pixel Frauen-Bundesliga;2024/2025
12.10.24;VfL Wolfsburg;Bayern München;2;0;6;Google Pixel Frauen-Bundesliga;2024/2025
13.10.24;1. FC Köln;1899 Hoffenheim;0;3;6;Google Pixel Frauen-Bundesliga;2024/2025
13.10.24;RB Leipzig;FC Carl Zeiss Jena;2;0;6;Google Pixel Frauen-Bundesliga;2024/2025
14.10.24;Eintracht Frankfurt;SC Freiburg;6;0;6;Google Pixel Frauen-Bundesliga;2024/2025
18.10.24;1899 Hoffenheim;Turbine Potsdam;6;0;7;Google Pixel Frauen-Bundesliga;2024/2025
19.10.24;Eintracht Frankfurt;Werder Bremen;0;1;7;Google Pixel Frauen-Bundesliga;2024/2025
19.10.24;FC Carl Zeiss Jena;1. FC Köln;2;2;7;Google Pixel Frauen-Bundesliga;2024/2025
20.10.24;SGS Essen;VfL Wolfsburg;0;2;7;Google Pixel Frauen-Bundesliga;2024/2025
20.10.24;SC Freiburg;RB Leipzig;4;1;7;Google Pixel Frauen-Bundesliga;2024/2025
20.10.24;Bayer Leverkusen;Bayern München;2;3;7;Google Pixel Frauen-Bundesliga;2024/2025
01.11.24;1. FC Köln;Bayer Leverkusen;1;2;8;Google Pixel Frauen-Bundesliga;2024/2025
02.11.24;Werder Bremen;SGS Essen;1;0;8;Google Pixel Frauen-Bundesliga;2024/2025
02.11.24;Turbine Potsdam;FC Carl Zeiss Jena;0;0;8;Google Pixel Frauen-Bundesliga;2024/2025
03.11.24;RB Leipzig;1899 Hoffenheim;3;1;8;Google Pixel Frauen-Bundesliga;2024/2025
03.11.24;VfL Wolfsburg;SC Freiburg;3;0;8;Google Pixel Frauen-Bundesliga;2024/2025
04.11.24;Bayern München;Eintracht Frankfurt;1;1;8;Google Pixel Frauen-Bundesliga;2024/2025
08.11.24;SC Freiburg;Bayern München;2;2;9;Google Pixel Frauen-Bundesliga;2024/2025
09.11.24;1899 Hoffenheim;VfL Wolfsburg;0;3;9;Google Pixel Frauen-Bundesliga;2024/2025
09.11.24;Eintracht Frankfurt;1. FC Köln;8;0;9;Google Pixel Frauen-Bundesliga;2024/2025
10.11.24;Bayer Leverkusen;Turbine Potsdam;3;0;9;Google Pixel Frauen-Bundesliga;2024/2025
10.11.24;FC Carl Zeiss Jena;Werder Bremen;0;1;9;Google Pixel Frauen-Bundesliga;2024/2025
11.11.24;SGS Essen;RB Leipzig;0;0;9;Google Pixel Frauen-Bundesliga;2024/2025
15.11.24;SC Freiburg;SGS Essen;1;0;10;Google Pixel Frauen-Bundesliga;2024/2025
16.11.24;VfL Wolfsburg;Turbine Potsdam;3;1;10;Google Pixel Frauen-Bundesliga;2024/2025
16.11.24;1899 Hoffenheim;Eintracht Frankfurt;0;1;10;Google Pixel Frauen-Bundesliga;2024/2025
17.11.24;Bayern München;FC Carl Zeiss Jena;5;0;10;Google Pixel Frauen-Bundesliga;2024/2025
17.11.24;RB Leipzig;Bayer Leverkusen;0;1;10;Google Pixel Frauen-Bundesliga;2024/2025
18.11.24;1. FC Köln;Werder Bremen;1;4;10;Google Pixel Frauen-Bundesliga;2024/2025
06.12.24;Bayer Leverkusen;VfL Wolfsburg;1;0;11;Google Pixel Frauen-Bundesliga;2024/2025
07.12.24;Turbine Potsdam;1. FC Köln;0;1;11;Google Pixel Frauen-Bundesliga;2024/2025
07.12.24;SGS Essen;Bayern München;0;2;11;Google Pixel Frauen-Bundesliga;2024/2025
08.12.24;Werder Bremen;SC Freiburg;0;3;11;Google Pixel Frauen-Bundesliga;2024/2025
09.12.24;Eintracht Frankfurt;RB Leipzig;3;0;11;Google Pixel Frauen-Bundesliga;2024/2025
26.01.25;FC Carl Zeiss Jena;1899 Hoffenheim;0;3;11;Google Pixel Frauen-Bundesliga;2024/2025
13.12.24;FC Carl Zeiss Jena;Eintracht Frankfurt;0;3;12;Google Pixel Frauen-Bundesliga;2024/2025
14.12.24;Bayer Leverkusen;SC Freiburg;2;0;12;Google Pixel Frauen-Bundesliga;2024/2025
14.12.24;Werder Bremen;VfL Wolfsburg;1;3;12;Google Pixel Frauen-Bundesliga;2024/2025
15.12.24;Bayern München;Turbine Potsdam;2;0;12;Google Pixel Frauen-Bundesliga;2024/2025
15.12.24;1899 Hoffenheim;SGS Essen;1;0;12;Google Pixel Frauen-Bundesliga;2024/2025
16.12.24;1. FC Köln;RB Leipzig;1;3;12;Google Pixel Frauen-Bundesliga;2024/2025
31.01.25;Eintracht Frankfurt;Bayer Leverkusen;3;2;13;Google Pixel Frauen-Bundesliga;2024/2025
01.02.25;Turbine Potsdam;Werder Bremen;1;4;13;Google Pixel Frauen-Bundesliga;2024/2025
02.02.25;SC Freiburg;1899 Hoffenheim;0;3;13;Google Pixel Frauen-Bundesliga;2024/2025
02.02.25;RB Leipzig;Bayern München;0;1;13;Google Pixel Frauen-Bundesliga;2024/2025
03.02.25;VfL Wolfsburg;FC Carl Zeiss Jena;3;0;13;Google Pixel Frauen-Bundesliga;2024/2025
11.02.25;SGS Essen;1. FC Köln;0;0;13;Google Pixel Frauen-Bundesliga;2024/2025
07.02.25;1. FC Köln;VfL Wolfsburg;0;0;14;Google Pixel Frauen-Bundesliga;2024/2025
08.02.25;Bayer Leverkusen;SGS Essen;1;1;14;Google Pixel Frauen-Bundesliga;2024/2025
08.02.25;Werder Bremen;RB Leipzig;1;4;14;Google Pixel Frauen-Bundesliga;2024/2025
09.02.25;1899 Hoffenheim;Bayern München;1;3;14;Google Pixel Frauen-Bundesliga;2024/2025
09.02.25;Eintracht Frankfurt;Turbine Potsdam;9;0;14;Google Pixel Frauen-Bundesliga;2024/2025
05.03.25;FC Carl Zeiss Jena;SC Freiburg;0;2;14;Google Pixel Frauen-Bundesliga;2024/2025
14.02.25;RB Leipzig;Turbine Potsdam;4;1;15;Google Pixel Frauen-Bundesliga;2024/2025
15.02.25;SC Freiburg;1. FC Köln;2;0;15;Google Pixel Frauen-Bundesliga;2024/2025
15.02.25;SGS Essen;FC Carl Zeiss Jena;4;1;15;Google Pixel Frauen-Bundesliga;2024/2025
16.02.25;1899 Hoffenheim;Bayer Leverkusen;1;0;15;Google Pixel Frauen-Bundesliga;2024/2025
16.02.25;Bayern München;Werder Bremen;1;0;15;Google Pixel Frauen-Bundesliga;2024/2025
16.02.25;VfL Wolfsburg;Eintracht Frankfurt;6;1;15;Google Pixel Frauen-Bundesliga;2024/2025
07.03.25;Eintracht Frankfurt;SGS Essen;2;1;16;Google Pixel Frauen-Bundesliga;2024/2025
08.03.25;Turbine Potsdam;SC Freiburg;0;1;16;Google Pixel Frauen-Bundesliga;2024/2025
08.03.25;RB Leipzig;VfL Wolfsburg;0;2;16;Google Pixel Frauen-Bundesliga;2024/2025
09.03.25;1. FC Köln;Bayern München;0;3;16;Google Pixel Frauen-Bundesliga;2024/2025
09.03.25;FC Carl Zeiss Jena;Bayer Leverkusen;0;2;16;Google Pixel Frauen-Bundesliga;2024/2025
10.03.25;Werder Bremen;1899 Hoffenheim;1;0;16;Google Pixel Frauen-Bundesliga;2024/2025
14.03.25;Bayern München;VfL Wolfsburg;3;1;17;Google Pixel Frauen-Bundesliga;2024/2025
15.03.25;FC Carl Zeiss Jena;RB Leipzig;1;1;17;Google Pixel Frauen-Bundesliga;2024/2025
15.03.25;1899 Hoffenheim;1. FC Köln;5;1;17;Google Pixel Frauen-Bundesliga;2024/2025
16.03.25;Bayer Leverkusen;Werder Bremen;6;0;17;Google Pixel Frauen-Bundesliga;2024/2025
16.03.25;SGS Essen;Turbine Potsdam;2;1;17;Google Pixel Frauen-Bundesliga;2024/2025
17.03.25;SC Freiburg;Eintracht Frankfurt;3;2;17;Google Pixel Frauen-Bundesliga;2024/2025
28.03.25;1. FC Köln;FC Carl Zeiss Jena;0;1;18;Google Pixel Frauen-Bundesliga;2024/2025
29.03.25;Werder Bremen;Eintracht Frankfurt;1;4;18;Google Pixel Frauen-Bundesliga;2024/2025
29.03.25;Turbine Potsdam;1899 Hoffenheim;0;7;18;Google Pixel Frauen-Bundesliga;2024/2025
30.03.25;RB Leipzig;SC Freiburg;1;1;18;Google Pixel Frauen-Bundesliga;2024/2025
30.03.25;Bayern München;Bayer Leverkusen;2;0;18;Google Pixel Frauen-Bundesliga;2024/2025
30.03.25;VfL Wolfsburg;SGS Essen;5;1;18;Google Pixel Frauen-Bundesliga;2024/2025
11.04.25;SGS Essen;Werder Bremen;0;1;19;Google Pixel Frauen-Bundesliga;2024/2025
12.04.25;FC Carl Zeiss Jena;Turbine Potsdam;1;0;19;Google Pixel Frauen-Bundesliga;2024/2025
12.04.25;Eintracht Frankfurt;Bayern München;0;3;19;Google Pixel Frauen-Bundesliga;2024/2025
13.04.25;SC Freiburg;VfL Wolfsburg;1;1;19;Google Pixel Frauen-Bundesliga;2024/2025
13.04.25;1899 Hoffenheim;RB Leipzig;5;2;19;Google Pixel Frauen-Bundesliga;2024/2025
14.04.25;Bayer Leverkusen;1. FC Köln;1;1;19;Google Pixel Frauen-Bundesliga;2024/2025
25.04.25;Turbine Potsdam;Bayer Leverkusen;1;3;20;Google Pixel Frauen-Bundesliga;2024/2025
26.04.25;RB Leipzig;SGS Essen;0;3;20;Google Pixel Frauen-Bundesliga;2024/2025
26.04.25;Werder Bremen;FC Carl Zeiss Jena;3;0;20;Google Pixel Frauen-Bundesliga;2024/2025
27.04.25;Bayern München;SC Freiburg;3;1;20;Google Pixel Frauen-Bundesliga;2024/2025
27.04.25;1. FC Köln;Eintracht Frankfurt;0;4;20;Google Pixel Frauen-Bundesliga;2024/2025
28.04.25;VfL Wolfsburg;1899 Hoffenheim;2;1;20;Google Pixel Frauen-Bundesliga;2024/2025
02.05.25;SGS Essen;SC Freiburg;0;0;21;Google Pixel Frauen-Bundesliga;2024/2025
03.05.25;Bayer Leverkusen;RB Leipzig;1;0;21;Google Pixel Frauen-Bundesliga;2024/2025
03.05.25;Turbine Potsdam;VfL Wolfsburg;0;4;21;Google Pixel Frauen-Bundesliga;2024/2025
04.05.25;Eintracht Frankfurt;1899 Hoffenheim;3;1;21;Google Pixel Frauen-Bundesliga;2024/2025
04.05.25;Werder Bremen;1. FC Köln;1;2;21;Google Pixel Frauen-Bundesliga;2024/2025
05.05.25;FC Carl Zeiss Jena;Bayern München;0;1;21;Google Pixel Frauen-Bundesliga;2024/2025
11.05.25;SC Freiburg;Werder Bremen;3;2;22;Google Pixel Frauen-Bundesliga;2024/2025
11.05.25;1899 Hoffenheim;FC Carl Zeiss Jena;4;0;22;Google Pixel Frauen-Bundesliga;2024/2025
11.05.25;1. FC Köln;Turbine Potsdam;4;0;22;Google Pixel Frauen-Bundesliga;2024/2025
11.05.25;VfL Wolfsburg;Bayer Leverkusen;3;1;22;Google Pixel Frauen-Bundesliga;2024/2025
11.05.25;RB Leipzig;Eintracht Frankfurt;0;2;22;Google Pixel Frauen-Bundesliga;2024/2025
11.05.25;Bayern München;SGS Essen;3;0;22;Google Pixel Frauen-Bundesliga;2024/2025
20.09.24;Chelsea FC Women;Aston Villa WFC;1;0;1;Women's Super League;2024/2025
21.09.24;Manchester United WFC;West Ham United WFC;3;0;1;Women's Super League;2024/2025
21.09.24;Brighton & Hove Albion WFC;Everton FC;4;0;1;Women's Super League;2024/2025
22.09.24;Arsenal WFC;Manchester City WFC;2;2;1;Women's Super League;2024/2025
22.09.24;Liverpool FC Women;Leicester City WFC;1;1;1;Women's Super League;2024/2025
22.09.24;Tottenham Hotspur WFC;Crystal Palace Women;4;0;1;Women's Super League;2024/2025
27.09.24;Crystal Palace Women;Chelsea FC Women;0;7;2;Women's Super League;2024/2025
29.09.24;Manchester City WFC;Brighton & Hove Albion WFC;1;0;2;Women's Super League;2024/2025
29.09.24;Everton FC;Manchester United WFC;0;1;2;Women's Super League;2024/2025
29.09.24;Leicester City WFC;Arsenal WFC;0;1;2;Women's Super League;2024/2025
29.09.24;West Ham United WFC;Liverpool FC Women;1;1;2;Women's Super League;2024/2025
29.09.24;Aston Villa WFC;Tottenham Hotspur WFC;2;2;2;Women's Super League;2024/2025
05.10.24;Brighton & Hove Albion WFC;Aston Villa WFC;4;2;3;Women's Super League;2024/2025
06.10.24;Manchester City WFC;West Ham United WFC;2;0;3;Women's Super League;2024/2025
06.10.24;Arsenal WFC;Everton FC;0;0;3;Women's Super League;2024/2025
06.10.24;Tottenham Hotspur WFC;Liverpool FC Women;2;3;3;Women's Super League;2024/2025
06.10.24;Leicester City WFC;Crystal Palace Women;0;2;3;Women's Super League;2024/2025
24.11.24;Chelsea FC Women;Manchester United WFC;1;0;3;Women's Super League;2024/2025
12.10.24;Arsenal WFC;Chelsea FC Women;1;2;4;Women's Super League;2024/2025
13.10.24;Manchester United WFC;Tottenham Hotspur WFC;3;0;4;Women's Super League;2024/2025
13.10.24;Aston Villa WFC;Leicester City WFC;0;0;4;Women's Super League;2024/2025
13.10.24;Crystal Palace Women;Brighton & Hove Albion WFC;0;1;4;Women's Super League;2024/2025
13.10.24;Everton FC;West Ham United WFC;1;1;4;Women's Super League;2024/2025
13.10.24;Liverpool FC Women;Manchester City WFC;1;2;4;Women's Super League;2024/2025
19.10.24;Brighton & Hove Albion WFC;Manchester United WFC;1;1;5;Women's Super League;2024/2025
20.10.24;Manchester City WFC;Aston Villa WFC;2;1;5;Women's Super League;2024/2025
20.10.24;Liverpool FC Women;Crystal Palace Women;1;1;5;Women's Super League;2024/2025
20.10.24;Leicester City WFC;Everton FC;1;0;5;Women's Super League;2024/2025
20.10.24;West Ham United WFC;Arsenal WFC;0;2;5;Women's Super League;2024/2025
20.10.24;Chelsea FC Women;Tottenham Hotspur WFC;5;2;5;Women's Super League;2024/2025
03.11.24;Manchester United WFC;Arsenal WFC;1;1;6;Women's Super League;2024/2025
03.11.24;Brighton & Hove Albion WFC;Leicester City WFC;1;0;6;Women's Super League;2024/2025
03.11.24;Crystal Palace Women;Manchester City WFC;0;3;6;Women's Super League;2024/2025
03.11.24;Tottenham Hotspur WFC;West Ham United WFC;2;1;6;Women's Super League;2024/2025
03.11.24;Aston Villa WFC;Liverpool FC Women;1;2;6;Women's Super League;2024/2025
03.11.24;Everton FC;Chelsea FC Women;0;5;6;Women's Super League;2024/2025
08.11.24;Arsenal WFC;Brighton & Hove Albion WFC;5;0;7;Women's Super League;2024/2025
08.11.24;Manchester City WFC;Tottenham Hotspur WFC;4;0;7;Women's Super League;2024/2025
10.11.24;Liverpool FC Women;Chelsea FC Women;0;3;7;Women's Super League;2024/2025
10.11.24;Crystal Palace Women;Everton FC;1;1;7;Women's Super League;2024/2025
10.11.24;West Ham United WFC;Leicester City WFC;1;0;7;Women's Super League;2024/2025
10.11.24;Manchester United WFC;Aston Villa WFC;0;0;7;Women's Super League;2024/2025
16.11.24;Brighton & Hove Albion WFC;West Ham United WFC;3;2;8;Women's Super League;2024/2025
16.11.24;Tottenham Hotspur WFC;Arsenal WFC;0;3;8;Women's Super League;2024/2025
16.11.24;Chelsea FC Women;Manchester City WFC;2;0;8;Women's Super League;2024/2025
17.11.24;Aston Villa WFC;Crystal Palace Women;3;2;8;Women's Super League;2024/2025
17.11.24;Everton FC;Liverpool FC Women;1;0;8;Women's Super League;2024/2025
17.11.24;Leicester City WFC;Manchester United WFC;0;2;8;Women's Super League;2024/2025
08.12.24;Manchester United WFC;Liverpool FC Women;4;0;9;Women's Super League;2024/2025
08.12.24;Manchester City WFC;Leicester City WFC;4;0;9;Women's Super League;2024/2025
08.12.24;Tottenham Hotspur WFC;Everton FC;2;1;9;Women's Super League;2024/2025
08.12.24;Arsenal WFC;Aston Villa WFC;4;0;9;Women's Super League;2024/2025
08.12.24;Chelsea FC Women;Brighton & Hove Albion WFC;4;2;9;Women's Super League;2024/2025
08.12.24;West Ham United WFC;Crystal Palace Women;5;2;9;Women's Super League;2024/2025
14.12.24;Leicester City WFC;Chelsea FC Women;1;1;10;Women's Super League;2024/2025
14.12.24;Brighton & Hove Albion WFC;Tottenham Hotspur WFC;1;1;10;Women's Super League;2024/2025
15.12.24;Everton FC;Manchester City WFC;2;1;10;Women's Super League;2024/2025
15.12.24;Aston Villa WFC;West Ham United WFC;3;1;10;Women's Super League;2024/2025
15.12.24;Crystal Palace Women;Manchester United WFC;0;1;10;Women's Super League;2024/2025
15.12.24;Liverpool FC Women;Arsenal WFC;0;1;10;Women's Super League;2024/2025
17.01.25;Liverpool FC Women;Brighton & Hove Albion WFC;2;1;11;Women's Super League;2024/2025
18.01.25;Everton FC;Aston Villa WFC;1;1;11;Women's Super League;2024/2025
19.01.25;Tottenham Hotspur WFC;Leicester City WFC;1;0;11;Women's Super League;2024/2025
19.01.25;Arsenal WFC;Crystal Palace Women;5;0;11;Women's Super League;2024/2025
19.01.25;West Ham United WFC;Chelsea FC Women;0;5;11;Women's Super League;2024/2025
19.01.25;Manchester City WFC;Manchester United WFC;2;4;11;Women's Super League;2024/2025
25.01.25;Aston Villa WFC;Manchester City WFC;2;4;12;Women's Super League;2024/2025
26.01.25;Chelsea FC Women;Arsenal WFC;1;0;12;Women's Super League;2024/2025
26.01.25;Crystal Palace Women;Tottenham Hotspur WFC;2;3;12;Women's Super League;2024/2025
26.01.25;Leicester City WFC;Liverpool FC Women;2;1;12;Women's Super League;2024/2025
26.01.25;West Ham United WFC;Everton FC;2;0;12;Women's Super League;2024/2025
26.01.25;Manchester United WFC;Brighton & Hove Albion WFC;3;0;12;Women's Super League;2024/2025
02.02.25;Manchester City WFC;Arsenal WFC;3;4;13;Women's Super League;2024/2025
02.02.25;Brighton & Hove Albion WFC;Crystal Palace Women;1;1;13;Women's Super League;2024/2025
02.02.25;Everton FC;Leicester City WFC;4;1;13;Women's Super League;2024/2025
02.02.25;Liverpool FC Women;West Ham United WFC;1;0;13;Women's Super League;2024/2025
02.02.25;Aston Villa WFC;Chelsea FC Women;0;1;13;Women's Super League;2024/2025
02.02.25;Tottenham Hotspur WFC;Manchester United WFC;0;1;13;Women's Super League;2024/2025
16.02.25;Manchester United WFC;Crystal Palace Women;3;1;14;Women's Super League;2024/2025
16.02.25;Arsenal WFC;Tottenham Hotspur WFC;5;0;14;Women's Super League;2024/2025
16.02.25;Chelsea FC Women;Everton FC;2;1;14;Women's Super League;2024/2025
16.02.25;Leicester City WFC;Aston Villa WFC;3;0;14;Women's Super League;2024/2025
16.02.25;West Ham United WFC;Brighton & Hove Albion WFC;3;1;14;Women's Super League;2024/2025
16.02.25;Manchester City WFC;Liverpool FC Women;4;0;14;Women's Super League;2024/2025
02.03.25;Manchester United WFC;Leicester City WFC;2;0;15;Women's Super League;2024/2025
02.03.25;Aston Villa WFC;Everton FC;0;2;15;Women's Super League;2024/2025
02.03.25;Crystal Palace Women;Liverpool FC Women;0;1;15;Women's Super League;2024/2025
02.03.25;Tottenham Hotspur WFC;Manchester City WFC;1;2;15;Women's Super League;2024/2025
02.03.25;Brighton & Hove Albion WFC;Chelsea FC Women;2;2;15;Women's Super League;2024/2025
02.03.25;Arsenal WFC;West Ham United WFC;4;3;15;Women's Super League;2024/2025
05.03.25;West Ham United WFC;Manchester City WFC;1;1;16;Women's Super League;2024/2025
05.03.25;Chelsea FC Women;Leicester City WFC;3;1;16;Women's Super League;2024/2025
14.03.25;Everton FC;Arsenal WFC;1;3;16;Women's Super League;2024/2025
14.03.25;Liverpool FC Women;Manchester United WFC;3;1;16;Women's Super League;2024/2025
16.03.25;Crystal Palace Women;Aston Villa WFC;3;1;16;Women's Super League;2024/2025
16.03.25;Tottenham Hotspur WFC;Brighton & Hove Albion WFC;0;1;16;Women's Super League;2024/2025
22.03.25;Everton FC;Crystal Palace Women;3;0;17;Women's Super League;2024/2025
22.03.25;Arsenal WFC;Liverpool FC Women;4;0;17;Women's Super League;2024/2025
23.03.25;West Ham United WFC;Tottenham Hotspur WFC;2;0;17;Women's Super League;2024/2025
23.03.25;Manchester City WFC;Chelsea FC Women;1;2;17;Women's Super League;2024/2025
23.03.25;Leicester City WFC;Brighton & Hove Albion WFC;3;2;17;Women's Super League;2024/2025
23.03.25;Aston Villa WFC;Manchester United WFC;0;4;17;Women's Super League;2024/2025
30.03.25;Manchester United WFC;Everton FC;2;0;18;Women's Super League;2024/2025
30.03.25;Brighton & Hove Albion WFC;Manchester City WFC;1;2;18;Women's Super League;2024/2025
30.03.25;Crystal Palace Women;Arsenal WFC;0;4;18;Women's Super League;2024/2025
30.03.25;Leicester City WFC;Tottenham Hotspur WFC;1;1;18;Women's Super League;2024/2025
30.03.25;Liverpool FC Women;Aston Villa WFC;1;2;18;Women's Super League;2024/2025
30.03.25;Chelsea FC Women;West Ham United WFC;2;2;18;Women's Super League;2024/2025
15.04.25;Arsenal WFC;Leicester City WFC;5;1;19;Women's Super League;2024/2025
19.04.25;West Ham United WFC;Manchester United WFC;0;0;19;Women's Super League;2024/2025
19.04.25;Brighton & Hove Albion WFC;Liverpool FC Women;1;2;19;Women's Super League;2024/2025
20.04.25;Manchester City WFC;Everton FC;1;1;19;Women's Super League;2024/2025
20.04.25;Tottenham Hotspur WFC;Aston Villa WFC;2;3;19;Women's Super League;2024/2025
23.04.25;Chelsea FC Women;Crystal Palace Women;4;0;19;Women's Super League;2024/2025
27.04.25;Liverpool FC Women;Tottenham Hotspur WFC;2;2;20;Women's Super League;2024/2025
27.04.25;Crystal Palace Women;West Ham United WFC;1;7;20;Women's Super League;2024/2025
27.04.25;Everton FC;Brighton & Hove Albion WFC;2;3;20;Women's Super League;2024/2025
27.04.25;Leicester City WFC;Manchester City WFC;0;1;20;Women's Super League;2024/2025
30.04.25;Aston Villa WFC;Arsenal WFC;5;2;20;Women's Super League;2024/2025
30.04.25;Manchester United WFC;Chelsea FC Women;0;1;20;Women's Super League;2024/2025
04.05.25;Liverpool FC Women;Everton FC;0;2;21;Women's Super League;2024/2025
04.05.25;Manchester United WFC;Manchester City WFC;2;2;21;Women's Super League;2024/2025
04.05.25;Crystal Palace Women;Leicester City WFC;2;2;21;Women's Super League;2024/2025
04.05.25;Tottenham Hotspur WFC;Chelsea FC Women;0;1;21;Women's Super League;2024/2025
04.05.25;West Ham United WFC;Aston Villa WFC;2;3;21;Women's Super League;2024/2025
05.05.25;Brighton & Hove Albion WFC;Arsenal WFC;4;2;21;Women's Super League;2024/2025
10.05.25;Arsenal WFC;Manchester United WFC;4;3;22;Women's Super League;2024/2025
10.05.25;Aston Villa WFC;Brighton & Hove Albion WFC;3;1;22;Women's Super League;2024/2025
10.05.25;Chelsea FC Women;Liverpool FC Women;1;0;22;Women's Super League;2024/2025
10.05.25;Everton FC;Tottenham Hotspur WFC;1;1;22;Women's Super League;2024/2025
10.05.25;Leicester City WFC;West Ham United WFC;4;2;22;Women's Super League;2024/2025
10.05.25;Manchester City WFC;Crystal Palace Women;5;2;22;Women's Super League;2024/2025
05.09.25;Chelsea FC Women;Manchester City WFC;2;1;1;Women's Super League;2025/2026
06.09.25;Arsenal WFC;London City Lionesses;4;1;1;Women's Super League;2025/2026
07.09.25;Liverpool FC Women;Everton FC;1;4;1;Women's Super League;2025/2026
07.09.25;Brighton & Hove Albion WFC;Aston Villa WFC;0;0;1;Women's Super League;2025/2026
07.09.25;Manchester United WFC;Leicester City WFC;4;0;1;Women's Super League;2025/2026
07.09.25;Tottenham Hotspur WFC;West Ham United WFC;1;0;1;Women's Super League;2025/2026
12.09.25;Manchester City WFC;Brighton & Hove Albion WFC;2;1;2;Women's Super League;2025/2026
12.09.25;West Ham United WFC;Arsenal WFC;1;5;2;Women's Super League;2025/2026
14.09.25;London City Lionesses;Manchester United WFC;1;5;2;Women's Super League;2025/2026
14.09.25;Aston Villa WFC;Chelsea FC Women;1;3;2;Women's Super League;2025/2026
14.09.25;Leicester City WFC;Liverpool FC Women;1;0;2;Women's Super League;2025/2026
14.09.25;Everton FC;Tottenham Hotspur WFC;0;2;2;Women's Super League;2025/2026
19.09.25;Everton FC;London City Lionesses;1;2;3;Women's Super League;2025/2026
19.09.25;Tottenham Hotspur WFC;Manchester City WFC;1;5;3;Women's Super League;2025/2026
21.09.25;Brighton & Hove Albion WFC;West Ham United WFC;4;1;3;Women's Super League;2025/2026
21.09.25;Chelsea FC Women;Leicester City WFC;1;0;3;Women's Super League;2025/2026
21.09.25;Manchester United WFC;Arsenal WFC;0;0;3;Women's Super League;2025/2026
21.09.25;Aston Villa WFC;Liverpool FC Women;3;0;3;Women's Super League;2025/2026
27.09.25;Arsenal WFC;Aston Villa WFC;1;1;4;Women's Super League;2025/2026
28.09.25;Leicester City WFC;Tottenham Hotspur WFC;1;2;4;Women's Super League;2025/2026
28.09.25;Manchester City WFC;London City Lionesses;4;1;4;Women's Super League;2025/2026
28.09.25;Brighton & Hove Albion WFC;Everton FC;1;0;4;Women's Super League;2025/2026
28.09.25;Liverpool FC Women;Manchester United WFC;0;2;4;Women's Super League;2025/2026
28.09.25;West Ham United WFC;Chelsea FC Women;0;4;4;Women's Super League;2025/2026
03.10.25;Manchester United WFC;Chelsea FC Women;1;1;5;Women's Super League;2025/2026
04.10.25;Manchester City WFC;Arsenal WFC;3;2;5;Women's Super League;2025/2026
05.10.25;West Ham United WFC;Aston Villa WFC;0;2;5;Women's Super League;2025/2026
05.10.25;London City Lionesses;Liverpool FC Women;1;0;5;Women's Super League;2025/2026
05.10.25;Tottenham Hotspur WFC;Brighton & Hove Albion WFC;1;0;5;Women's Super League;2025/2026
05.10.25;Leicester City WFC;Everton FC;1;1;5;Women's Super League;2025/2026
12.10.25;Chelsea FC Women;Tottenham Hotspur WFC;1;0;6;Women's Super League;2025/2026
12.10.25;London City Lionesses;West Ham United WFC;1;0;6;Women's Super League;2025/2026
12.10.25;Aston Villa WFC;Leicester City WFC;0;0;6;Women's Super League;2025/2026
12.10.25;Everton FC;Manchester United WFC;1;4;6;Women's Super League;2025/2026
12.10.25;Arsenal WFC;Brighton & Hove Albion WFC;1;0;6;Women's Super League;2025/2026
12.10.25;Liverpool FC Women;Manchester City WFC;1;2;6;Women's Super League;2025/2026
01.11.25;Manchester City WFC;West Ham United WFC;1;0;7;Women's Super League;2025/2026
01.11.25;Chelsea FC Women;London City Lionesses;2;0;7;Women's Super League;2025/2026
02.11.25;Aston Villa WFC;Everton FC;3;3;7;Women's Super League;2025/2026
02.11.25;Brighton & Hove Albion WFC;Manchester United WFC;2;3;7;Women's Super League;2025/2026
02.11.25;Leicester City WFC;Arsenal WFC;1;4;7;Women's Super League;2025/2026
02.11.25;Tottenham Hotspur WFC;Liverpool FC Women;2;1;7;Women's Super League;2025/2026
08.11.25;Arsenal WFC;Chelsea FC Women;1;1;8;Women's Super League;2025/2026
08.11.25;Manchester United WFC;Aston Villa WFC;0;1;8;Women's Super League;2025/2026
09.11.25;London City Lionesses;Tottenham Hotspur WFC;4;2;8;Women's Super League;2025/2026
09.11.25;West Ham United WFC;Leicester City WFC;1;1;8;Women's Super League;2025/2026
09.11.25;Liverpool FC Women;Brighton & Hove Albion WFC;1;1;8;Women's Super League;2025/2026
09.11.25;Everton FC;Manchester City WFC;1;2;8;Women's Super League;2025/2026
15.11.25;Manchester City WFC;Manchester United WFC;3;0;9;Women's Super League;2025/2026
16.11.25;West Ham United WFC;Everton FC;3;1;9;Women's Super League;2025/2026
16.11.25;Aston Villa WFC;London City Lionesses;1;3;9;Women's Super League;2025/2026
16.11.25;Brighton & Hove Albion WFC;Leicester City WFC;4;1;9;Women's Super League;2025/2026
16.11.25;Liverpool FC Women;Chelsea FC Women;1;1;9;Women's Super League;2025/2026
16.11.25;Tottenham Hotspur WFC;Arsenal WFC;0;0;9;Women's Super League;2025/2026
06.12.15;Arsenal WFC;Liverpool FC Women;2;1;10;Women's Super League;2025/2026
07.12.25;London City Lionesses;Brighton & Hove Albion WFC;0;1;10;Women's Super League;2025/2026
07.12.25;Tottenham Hotspur WFC;Aston Villa WFC;2;1;10;Women's Super League;2025/2026
07.12.25;Leicester City WFC;Manchester City WFC;0;3;10;Women's Super League;2025/2026
07.12.25;Manchester United WFC;West Ham United WFC;2;1;10;Women's Super League;2025/2026
07.12.25;Chelsea FC Women;Everton FC;0;1;10;Women's Super League;2025/2026
13.12.25;Everton FC;Arsenal WFC;1;3;11;Women's Super League;2025/2026
14.12.25;West Ham United WFC;Liverpool FC Women;2;2;11;Women's Super League;2025/2026
14.12.25;Manchester City WFC;Aston Villa WFC;6;1;11;Women's Super League;2025/2026
14.12.25;Brighton & Hove Albion WFC;Chelsea FC Women;0;3;11;Women's Super League;2025/2026
14.12.25;Leicester City WFC;London City Lionesses;1;0;11;Women's Super League;2025/2026
14.12.25;Manchester United WFC;Tottenham Hotspur WFC;3;3;11;Women's Super League;2025/2026
10.01.26;Arsenal WFC;Manchester United WFC;0;0;12;Women's Super League;2025/2026
11.01.26;Manchester City WFC;Everton FC;2;0;12;Women's Super League;2025/2026
11.01.26;Aston Villa WFC;Brighton & Hove Albion WFC;2;1;12;Women's Super League;2025/2026
11.01.26;Chelsea FC Women;West Ham United WFC;5;0;12;Women's Super League;2025/2026
11.01.26;Tottenham Hotspur WFC;Leicester City WFC;1;0;12;Women's Super League;2025/2026
11.01.26;Liverpool FC Women;London City Lionesses;0;0;12;Women's Super League;2025/2026
23.01.26;Everton FC;Brighton & Hove Albion WFC;0;1;13;Women's Super League;2025/2026
24.01.26;Chelsea FC Women;Arsenal WFC;0;2;13;Women's Super League;2025/2026
25.01.26;Aston Villa WFC;Manchester United WFC;1;4;13;Women's Super League;2025/2026
25.01.26;Liverpool FC Women;Tottenham Hotspur WFC;2;0;13;Women's Super League;2025/2026
25.01.26;London City Lionesses;Manchester City WFC;1;2;13;Women's Super League;2025/2026
25.01.26;Leicester City WFC;West Ham United WFC;1;2;13;Women's Super League;2025/2026
01.02.26;West Ham United WFC;Tottenham Hotspur WFC;1;2;14;Women's Super League;2025/2026
01.02.26;Manchester United WFC;Liverpool FC Women;3;1;14;Women's Super League;2025/2026
01.02.26;Brighton & Hove Albion WFC;London City Lionesses;1;2;14;Women's Super League;2025/2026
01.02.26;Everton FC;Aston Villa WFC;2;1;14;Women's Super League;2025/2026
01.02.26;Manchester City WFC;Chelsea FC Women;5;1;14;Women's Super League;2025/2026
29.04.26;Arsenal WFC;Leicester City WFC;7;0;14;Women's Super League;2025/2026
07.02.26;Leicester City WFC;Manchester United WFC;0;2;15;Women's Super League;2025/2026
08.02.26;London City Lionesses;Everton FC;0;1;15;Women's Super League;2025/2026
08.02.26;West Ham United WFC;Brighton & Hove Albion WFC;3;2;15;Women's Super League;2025/2026
08.02.26;Arsenal WFC;Manchester City WFC;1;0;15;Women's Super League;2025/2026
08.02.26;Liverpool FC Women;Aston Villa WFC;4;1;15;Women's Super League;2025/2026
08.02.26;Tottenham Hotspur WFC;Chelsea FC Women;0;2;15;Women's Super League;2025/2026
13.02.26;Manchester City WFC;Leicester City WFC;6;0;16;Women's Super League;2025/2026
15.02.26;Manchester United WFC;London City Lionesses;2;1;16;Women's Super League;2025/2026
15.02.26;Aston Villa WFC;Tottenham Hotspur WFC;3;7;16;Women's Super League;2025/2026
15.02.26;Chelsea FC Women;Liverpool FC Women;2;0;16;Women's Super League;2025/2026
15.02.26;Everton FC;West Ham United WFC;1;0;16;Women's Super League;2025/2026
06.05.26;Brighton & Hove Albion WFC;Arsenal WFC;1;1;16;Women's Super League;2025/2026
15.03.26;Aston Villa WFC;Manchester City WFC;0;0;17;Women's Super League;2025/2026
15.03.26;Liverpool FC Women;Leicester City WFC;2;0;17;Women's Super League;2025/2026
15.03.26;London City Lionesses;Arsenal WFC;0;2;17;Women's Super League;2025/2026
15.03.26;Tottenham Hotspur WFC;Everton FC;1;2;17;Women's Super League;2025/2026
18.03.26;Chelsea FC Women;Brighton & Hove Albion WFC;2;1;17;Women's Super League;2025/2026
18.03.26;West Ham United WFC;Manchester United WFC;0;0;17;Women's Super League;2025/2026
21.03.26;Arsenal WFC;West Ham United WFC;5;0;18;Women's Super League;2025/2026
21.03.26;Manchester United WFC;Everton FC;2;1;18;Women's Super League;2025/2026
21.03.26;London City Lionesses;Chelsea FC Women;1;1;18;Women's Super League;2025/2026
21.03.26;Manchester City WFC;Tottenham Hotspur WFC;5;2;18;Women's Super League;2025/2026
22.03.26;Brighton & Hove Albion WFC;Liverpool FC Women;0;0;18;Women's Super League;2025/2026
22.03.26;Leicester City WFC;Aston Villa WFC;1;2;18;Women's Super League;2025/2026
28.03.26;Everton FC;Liverpool FC Women;2;3;19;Women's Super League;2025/2026
28.03.26;Manchester United WFC;Manchester City WFC;0;3;19;Women's Super League;2025/2026
28.03.26;Arsenal WFC;Tottenham Hotspur WFC;5;2;19;Women's Super League;2025/2026
29.03.26;West Ham United WFC;London City Lionesses;1;1;19;Women's Super League;2025/2026
29.03.26;Chelsea FC Women;Aston Villa WFC;4;3;19;Women's Super League;2025/2026
29.03.26;Leicester City WFC;Brighton & Hove Albion WFC;0;1;19;Women's Super League;2025/2026
25.04.26;Brighton & Hove Albion WFC;Manchester City WFC;3;2;20;Women's Super League;2025/2026
26.04.26;London City Lionesses;Leicester City WFC;5;1;20;Women's Super League;2025/2026
26.04.26;Everton FC;Chelsea FC Women;1;4;20;Women's Super League;2025/2026
26.04.26;Tottenham Hotspur WFC;Manchester United WFC;0;0;20;Women's Super League;2025/2026
26.04.26;Liverpool FC Women;West Ham United WFC;0;1;20;Women's Super League;2025/2026
09.05.26;Aston Villa WFC;Arsenal WFC;0;3;20;Women's Super League;2025/2026
02.05.26;Manchester United WFC;Brighton & Hove Albion WFC;1;1;21;Women's Super League;2025/2026
03.05.26;Manchester City WFC;Liverpool FC Women;1;0;21;Women's Super League;2025/2026
03.05.26;Tottenham Hotspur WFC;London City Lionesses;2;1;21;Women's Super League;2025/2026
03.05.26;Leicester City WFC;Chelsea FC Women;1;3;21;Women's Super League;2025/2026
04.05.26;Aston Villa WFC;West Ham United WFC;0;2;21;Women's Super League;2025/2026
13.05.26;Arsenal WFC;Everton FC;1;0;21;Women's Super League;2025/2026
16.05.26;Brighton & Hove Albion WFC;Tottenham Hotspur WFC;1;2;22;Women's Super League;2025/2026
16.05.26;Chelsea FC Women;Manchester United WFC;1;0;22;Women's Super League;2025/2026
16.05.26;Everton FC;Leicester City WFC;1;0;22;Women's Super League;2025/2026
16.05.26;Liverpool FC Women;Arsenal WFC;1;3;22;Women's Super League;2025/2026
16.05.26;London City Lionesses;Aston Villa WFC;2;1;22;Women's Super League;2025/2026
16.05.26;West Ham United WFC;Manchester City WFC;1;4;22;Women's Super League;2025/2026
01.10.23;Aston Villa WFC;Manchester United WFC;1;2;1;Women's Super League;2023/2024
01.10.23;Everton FC;Brighton & Hove Albion WFC;1;2;1;Women's Super League;2023/2024
01.10.23;Bristol City WFC;Leicester City WFC;2;4;1;Women's Super League;2023/2024
01.10.23;Arsenal WFC;Liverpool FC Women;0;1;1;Women's Super League;2023/2024
01.10.23;West Ham United WFC;Manchester City WFC;0;2;1;Women's Super League;2023/2024
01.10.23;Chelsea FC Women;Tottenham Hotspur WFC;2;1;1;Women's Super League;2023/2024
06.10.23;Manchester United WFC;Arsenal WFC;2;2;2;Women's Super League;2023/2024
08.10.23;Brighton & Hove Albion WFC;West Ham United WFC;0;2;2;Women's Super League;2023/2024
08.10.23;Manchester City WFC;Chelsea FC Women;1;1;2;Women's Super League;2023/2024
08.10.23;Tottenham Hotspur WFC;Bristol City WFC;3;1;2;Women's Super League;2023/2024
08.10.23;Leicester City WFC;Everton FC;1;0;2;Women's Super League;2023/2024
08.10.23;Liverpool FC Women;Aston Villa WFC;2;0;2;Women's Super League;2023/2024
14.10.23;Chelsea FC Women;West Ham United WFC;2;0;3;Women's Super League;2023/2024
15.10.23;Manchester United WFC;Leicester City WFC;1;1;3;Women's Super League;2023/2024
15.10.23;Manchester City WFC;Bristol City WFC;5;0;3;Women's Super League;2023/2024
15.10.23;Arsenal WFC;Aston Villa WFC;2;1;3;Women's Super League;2023/2024
15.10.23;Brighton & Hove Albion WFC;Tottenham Hotspur WFC;1;3;3;Women's Super League;2023/2024
15.10.23;Liverpool FC Women;Everton FC;0;1;3;Women's Super League;2023/2024
21.10.23;Aston Villa WFC;Tottenham Hotspur WFC;2;4;4;Women's Super League;2023/2024
21.10.23;Leicester City WFC;Manchester City WFC;0;1;4;Women's Super League;2023/2024
22.10.23;Everton FC;Manchester United WFC;0;5;4;Women's Super League;2023/2024
22.10.23;Chelsea FC Women;Brighton & Hove Albion WFC;4;2;4;Women's Super League;2023/2024
22.10.23;West Ham United WFC;Liverpool FC Women;1;1;4;Women's Super League;2023/2024
22.10.23;Bristol City WFC;Arsenal WFC;1;2;4;Women's Super League;2023/2024
04.11.23;Aston Villa WFC;Chelsea FC Women;0;6;5;Women's Super League;2023/2024
05.11.23;Arsenal WFC;Manchester City WFC;2;1;5;Women's Super League;2023/2024
05.11.23;Liverpool FC Women;Leicester City WFC;2;1;5;Women's Super League;2023/2024
05.11.23;Tottenham Hotspur WFC;Everton FC;1;1;5;Women's Super League;2023/2024
05.11.23;West Ham United WFC;Bristol City WFC;2;3;5;Women's Super League;2023/2024
05.11.23;Brighton & Hove Albion WFC;Manchester United WFC;2;2;5;Women's Super League;2023/2024
12.11.23;Manchester United WFC;West Ham United WFC;5;0;6;Women's Super League;2023/2024
12.11.23;Tottenham Hotspur WFC;Liverpool FC Women;1;1;6;Women's Super League;2023/2024
12.11.23;Everton FC;Chelsea FC Women;0;3;6;Women's Super League;2023/2024
12.11.23;Manchester City WFC;Brighton & Hove Albion WFC;0;1;6;Women's Super League;2023/2024
12.11.23;Bristol City WFC;Aston Villa WFC;0;2;6;Women's Super League;2023/2024
12.11.23;Leicester City WFC;Arsenal WFC;2;6;6;Women's Super League;2023/2024
18.11.23;Chelsea FC Women;Liverpool FC Women;5;1;7;Women's Super League;2023/2024
19.11.23;Everton FC;Bristol City WFC;2;2;7;Women's Super League;2023/2024
19.11.23;Brighton & Hove Albion WFC;Arsenal WFC;0;3;7;Women's Super League;2023/2024
19.11.23;Leicester City WFC;Tottenham Hotspur WFC;1;1;7;Women's Super League;2023/2024
19.11.23;West Ham United WFC;Aston Villa WFC;2;3;7;Women's Super League;2023/2024
19.11.23;Manchester United WFC;Manchester City WFC;1;3;7;Women's Super League;2023/2024
26.11.23;Bristol City WFC;Manchester United WFC;0;2;8;Women's Super League;2023/2024
26.11.23;Arsenal WFC;West Ham United WFC;3;0;8;Women's Super League;2023/2024
26.11.23;Chelsea FC Women;Leicester City WFC;5;2;8;Women's Super League;2023/2024
26.11.23;Liverpool FC Women;Brighton & Hove Albion WFC;4;0;8;Women's Super League;2023/2024
26.11.23;Aston Villa WFC;Everton FC;1;2;8;Women's Super League;2023/2024
26.11.23;Manchester City WFC;Tottenham Hotspur WFC;7;0;8;Women's Super League;2023/2024
09.12.23;Manchester City WFC;Aston Villa WFC;2;1;9;Women's Super League;2023/2024
10.12.23;Arsenal WFC;Chelsea FC Women;4;1;9;Women's Super League;2023/2024
10.12.23;Brighton & Hove Albion WFC;Leicester City WFC;2;2;9;Women's Super League;2023/2024
10.12.23;Liverpool FC Women;Bristol City WFC;1;1;9;Women's Super League;2023/2024
10.12.23;West Ham United WFC;Everton FC;0;1;9;Women's Super League;2023/2024
10.12.23;Tottenham Hotspur WFC;Manchester United WFC;0;4;9;Women's Super League;2023/2024
16.12.23;Tottenham Hotspur WFC;Arsenal WFC;1;0;10;Women's Super League;2023/2024
17.12.23;Manchester United WFC;Liverpool FC Women;1;2;10;Women's Super League;2023/2024
17.12.23;Everton FC;Manchester City WFC;1;4;10;Women's Super League;2023/2024
17.12.23;Bristol City WFC;Chelsea FC Women;0;3;10;Women's Super League;2023/2024
17.12.23;Leicester City WFC;West Ham United WFC;1;1;10;Women's Super League;2023/2024
17.12.23;Aston Villa WFC;Brighton & Hove Albion WFC;1;0;10;Women's Super League;2023/2024
19.01.24;Leicester City WFC;Aston Villa WFC;0;1;11;Women's Super League;2023/2024
20.01.24;Arsenal WFC;Everton FC;2;1;11;Women's Super League;2023/2024
21.01.24;Chelsea FC Women;Manchester United WFC;3;1;11;Women's Super League;2023/2024
21.01.24;Brighton & Hove Albion WFC;Bristol City WFC;3;2;11;Women's Super League;2023/2024
21.01.24;Manchester City WFC;Liverpool FC Women;5;1;11;Women's Super League;2023/2024
21.01.24;West Ham United WFC;Tottenham Hotspur WFC;3;4;11;Women's Super League;2023/2024
27.01.24;Brighton & Hove Albion WFC;Chelsea FC Women;0;3;12;Women's Super League;2023/2024
28.01.24;Manchester United WFC;Aston Villa WFC;2;1;12;Women's Super League;2023/2024
28.01.24;Everton FC;Leicester City WFC;0;1;12;Women's Super League;2023/2024
28.01.24;Bristol City WFC;West Ham United WFC;1;2;12;Women's Super League;2023/2024
28.01.24;Tottenham Hotspur WFC;Manchester City WFC;0;2;12;Women's Super League;2023/2024
28.01.24;Liverpool FC Women;Arsenal WFC;0;2;12;Women's Super League;2023/2024
03.02.24;Aston Villa WFC;Bristol City WFC;2;2;13;Women's Super League;2023/2024
04.02.24;Manchester United WFC;Brighton & Hove Albion WFC;2;0;13;Women's Super League;2023/2024
04.02.24;West Ham United WFC;Arsenal WFC;2;1;13;Women's Super League;2023/2024
04.02.24;Manchester City WFC;Leicester City WFC;2;0;13;Women's Super League;2023/2024
04.02.24;Liverpool FC Women;Tottenham Hotspur WFC;1;1;13;Women's Super League;2023/2024
04.02.24;Chelsea FC Women;Everton FC;3;0;13;Women's Super League;2023/2024
16.02.24;Chelsea FC Women;Manchester City WFC;0;1;14;Women's Super League;2023/2024
17.02.24;Arsenal WFC;Manchester United WFC;3;1;14;Women's Super League;2023/2024
18.02.24;Brighton & Hove Albion WFC;Liverpool FC Women;0;1;14;Women's Super League;2023/2024
18.02.24;Everton FC;West Ham United WFC;2;0;14;Women's Super League;2023/2024
18.02.24;Tottenham Hotspur WFC;Aston Villa WFC;1;2;14;Women's Super League;2023/2024
18.02.24;Leicester City WFC;Bristol City WFC;5;2;14;Women's Super League;2023/2024
02.03.24;Manchester City WFC;Everton FC;2;1;15;Women's Super League;2023/2024
03.03.24;Arsenal WFC;Tottenham Hotspur WFC;1;0;15;Women's Super League;2023/2024
03.03.24;Aston Villa WFC;Liverpool FC Women;1;4;15;Women's Super League;2023/2024
03.03.24;Bristol City WFC;Brighton & Hove Albion WFC;3;7;15;Women's Super League;2023/2024
03.03.24;West Ham United WFC;Manchester United WFC;1;1;15;Women's Super League;2023/2024
03.03.24;Leicester City WFC;Chelsea FC Women;0;4;15;Women's Super League;2023/2024
15.03.24;Chelsea FC Women;Arsenal WFC;3;1;16;Women's Super League;2023/2024
16.03.24;Everton FC;Aston Villa WFC;1;2;16;Women's Super League;2023/2024
17.03.24;Liverpool FC Women;West Ham United WFC;3;1;16;Women's Super League;2023/2024
17.03.24;Manchester United WFC;Bristol City WFC;2;0;16;Women's Super League;2023/2024
17.03.24;Brighton & Hove Albion WFC;Manchester City WFC;1;4;16;Women's Super League;2023/2024
17.03.24;Tottenham Hotspur WFC;Leicester City WFC;1;0;16;Women's Super League;2023/2024
23.03.24;Manchester City WFC;Manchester United WFC;3;1;17;Women's Super League;2023/2024
24.03.24;Everton FC;Liverpool FC Women;0;0;17;Women's Super League;2023/2024
24.03.24;Bristol City WFC;Tottenham Hotspur WFC;0;1;17;Women's Super League;2023/2024
24.03.24;Leicester City WFC;Brighton & Hove Albion WFC;2;3;17;Women's Super League;2023/2024
24.03.24;West Ham United WFC;Chelsea FC Women;0;2;17;Women's Super League;2023/2024
24.03.24;Aston Villa WFC;Arsenal WFC;1;3;17;Women's Super League;2023/2024
30.03.24;Aston Villa WFC;Leicester City WFC;2;2;18;Women's Super League;2023/2024
30.03.24;Liverpool FC Women;Manchester City WFC;1;4;18;Women's Super League;2023/2024
31.03.24;Manchester United WFC;Everton FC;4;1;18;Women's Super League;2023/2024
31.03.24;West Ham United WFC;Brighton & Hove Albion WFC;0;0;18;Women's Super League;2023/2024
14.04.24;Arsenal WFC;Bristol City WFC;5;0;18;Women's Super League;2023/2024
15.05.24;Tottenham Hotspur WFC;Chelsea FC Women;0;1;18;Women's Super League;2023/2024
17.04.24;Chelsea FC Women;Aston Villa WFC;3;0;19;Women's Super League;2023/2024
19.04.24;Brighton & Hove Albion WFC;Everton FC;1;2;19;Women's Super League;2023/2024
20.04.24;Bristol City WFC;Liverpool FC Women;0;1;19;Women's Super League;2023/2024
21.04.24;Manchester United WFC;Tottenham Hotspur WFC;2;2;19;Women's Super League;2023/2024
21.04.24;Arsenal WFC;Leicester City WFC;3;0;19;Women's Super League;2023/2024
21.04.24;Manchester City WFC;West Ham United WFC;5;0;19;Women's Super League;2023/2024
28.04.24;Everton FC;Arsenal WFC;1;1;20;Women's Super League;2023/2024
28.04.24;Aston Villa WFC;West Ham United WFC;1;1;20;Women's Super League;2023/2024
28.04.24;Tottenham Hotspur WFC;Brighton & Hove Albion WFC;1;1;20;Women's Super League;2023/2024
28.04.24;Leicester City WFC;Manchester United WFC;0;1;20;Women's Super League;2023/2024
28.04.24;Bristol City WFC;Manchester City WFC;0;4;20;Women's Super League;2023/2024
01.05.24;Liverpool FC Women;Chelsea FC Women;4;3;20;Women's Super League;2023/2024
04.05.24;Everton FC;Tottenham Hotspur WFC;2;2;21;Women's Super League;2023/2024
04.05.24;Brighton & Hove Albion WFC;Aston Villa WFC;0;1;21;Women's Super League;2023/2024
05.05.24;Liverpool FC Women;Manchester United WFC;1;0;21;Women's Super League;2023/2024
05.05.24;Manchester City WFC;Arsenal WFC;1;2;21;Women's Super League;2023/2024
05.05.24;West Ham United WFC;Leicester City WFC;1;1;21;Women's Super League;2023/2024
05.05.24;Chelsea FC Women;Bristol City WFC;8;0;21;Women's Super League;2023/2024
18.05.24;Aston Villa WFC;Manchester City WFC;1;2;22;Women's Super League;2023/2024
18.05.24;Bristol City WFC;Everton FC;0;4;22;Women's Super League;2023/2024
18.05.24;Arsenal WFC;Brighton & Hove Albion WFC;5;0;22;Women's Super League;2023/2024
18.05.24;Leicester City WFC;Liverpool FC Women;0;4;22;Women's Super League;2023/2024
18.05.24;Manchester United WFC;Chelsea FC Women;0;6;22;Women's Super League;2023/2024
18.05.24;Tottenham Hotspur WFC;West Ham United WFC;3;1;22;Women's Super League;2023/2024
28.08.22;Chelsea FC Women;West Ham United WFC;3;1;1;Women's Super League;2022/2023
29.08.22;Everton FC;Leicester City WFC;1;0;1;Women's Super League;2022/2023
24.11.22;Reading WFC;Liverpool FC Women;3;3;1;Women's Super League;2022/2023
11.02.23;Manchester City WFC;Arsenal WFC;2;1;1;Women's Super League;2022/2023
12.02.23;Tottenham Hotspur WFC;Manchester United WFC;1;2;1;Women's Super League;2022/2023
12.02.23;Brighton & Hove Albion WFC;Aston Villa WFC;2;6;1;Women's Super League;2022/2023
16.09.22;Arsenal WFC;Brighton & Hove Albion WFC;4;0;2;Women's Super League;2022/2023
17.09.22;Manchester United WFC;Reading WFC;4;0;2;Women's Super League;2022/2023
18.09.22;Aston Villa WFC;Manchester City WFC;4;3;2;Women's Super League;2022/2023
18.09.22;Leicester City WFC;Tottenham Hotspur WFC;1;2;2;Women's Super League;2022/2023
18.09.22;West Ham United WFC;Everton FC;1;0;2;Women's Super League;2022/2023
18.09.22;Liverpool FC Women;Chelsea FC Women;2;1;2;Women's Super League;2022/2023
24.09.22;Arsenal WFC;Tottenham Hotspur WFC;4;0;3;Women's Super League;2022/2023
25.09.22;Brighton & Hove Albion WFC;Reading WFC;2;1;3;Women's Super League;2022/2023
25.09.22;Leicester City WFC;Aston Villa WFC;0;2;3;Women's Super League;2022/2023
25.09.22;West Ham United WFC;Manchester United WFC;0;2;3;Women's Super League;2022/2023
25.09.22;Chelsea FC Women;Manchester City WFC;2;0;3;Women's Super League;2022/2023
25.09.22;Liverpool FC Women;Everton FC;0;3;3;Women's Super League;2022/2023
15.10.22;Aston Villa WFC;West Ham United WFC;1;2;4;Women's Super League;2022/2023
16.10.22;Manchester United WFC;Brighton & Hove Albion WFC;4;0;4;Women's Super League;2022/2023
16.10.22;Everton FC;Chelsea FC Women;1;3;4;Women's Super League;2022/2023
16.10.22;Manchester City WFC;Leicester City WFC;4;0;4;Women's Super League;2022/2023
16.10.22;Tottenham Hotspur WFC;Liverpool FC Women;1;0;4;Women's Super League;2022/2023
16.10.22;Reading WFC;Arsenal WFC;0;1;4;Women's Super League;2022/2023
22.10.22;Tottenham Hotspur WFC;Manchester City WFC;0;3;5;Women's Super League;2022/2023
22.10.22;Aston Villa WFC;Everton FC;0;1;5;Women's Super League;2022/2023
23.10.22;Liverpool FC Women;Arsenal WFC;0;2;5;Women's Super League;2022/2023
23.10.22;Leicester City WFC;Manchester United WFC;0;1;5;Women's Super League;2022/2023
23.10.22;West Ham United WFC;Reading WFC;3;2;5;Women's Super League;2022/2023
23.10.22;Brighton & Hove Albion WFC;Chelsea FC Women;0;2;5;Women's Super League;2022/2023
30.10.22;Brighton & Hove Albion WFC;Tottenham Hotspur WFC;0;8;6;Women's Super League;2022/2023
30.10.22;Chelsea FC Women;Aston Villa WFC;3;1;6;Women's Super League;2022/2023
30.10.22;Everton FC;Manchester United WFC;0;3;6;Women's Super League;2022/2023
30.10.22;Reading WFC;Leicester City WFC;2;1;6;Women's Super League;2022/2023
30.10.22;Manchester City WFC;Liverpool FC Women;2;1;6;Women's Super League;2022/2023
30.10.22;Arsenal WFC;West Ham United WFC;3;1;6;Women's Super League;2022/2023
06.11.22;Liverpool FC Women;Aston Villa WFC;0;1;7;Women's Super League;2022/2023
06.11.22;Reading WFC;Manchester City WFC;0;3;7;Women's Super League;2022/2023
06.11.22;Leicester City WFC;Arsenal WFC;0;4;7;Women's Super League;2022/2023
06.11.22;West Ham United WFC;Brighton & Hove Albion WFC;4;5;7;Women's Super League;2022/2023
06.11.22;Manchester United WFC;Chelsea FC Women;1;3;7;Women's Super League;2022/2023
14.12.22;Tottenham Hotspur WFC;Everton FC;0;3;7;Women's Super League;2022/2023
19.11.22;Everton FC;Manchester City WFC;1;2;8;Women's Super League;2022/2023
19.11.22;Arsenal WFC;Manchester United WFC;2;3;8;Women's Super League;2022/2023
20.11.22;Chelsea FC Women;Tottenham Hotspur WFC;3;0;8;Women's Super League;2022/2023
20.11.22;Aston Villa WFC;Reading WFC;3;1;8;Women's Super League;2022/2023
20.11.22;Brighton & Hove Albion WFC;Liverpool FC Women;3;3;8;Women's Super League;2022/2023
20.11.22;West Ham United WFC;Leicester City WFC;1;0;8;Women's Super League;2022/2023
03.12.22;Manchester United WFC;Aston Villa WFC;5;0;9;Women's Super League;2022/2023
03.12.22;Arsenal WFC;Everton FC;1;0;9;Women's Super League;2022/2023
03.12.22;Leicester City WFC;Chelsea FC Women;0;8;9;Women's Super League;2022/2023
04.12.22;Reading WFC;Tottenham Hotspur WFC;1;0;9;Women's Super League;2022/2023
04.12.22;Liverpool FC Women;West Ham United WFC;2;0;9;Women's Super League;2022/2023
04.12.22;Manchester City WFC;Brighton & Hove Albion WFC;3;1;9;Women's Super League;2022/2023
11.12.22;Manchester City WFC;Manchester United WFC;1;1;10;Women's Super League;2022/2023
11.12.22;Tottenham Hotspur WFC;West Ham United WFC;0;2;10;Women's Super League;2022/2023
11.12.22;Aston Villa WFC;Arsenal WFC;1;4;10;Women's Super League;2022/2023
11.12.22;Chelsea FC Women;Reading WFC;3;2;10;Women's Super League;2022/2023
12.02.23;Liverpool FC Women;Leicester City WFC;0;1;10;Women's Super League;2022/2023
19.04.23;Brighton & Hove Albion WFC;Everton FC;3;2;10;Women's Super League;2022/2023
14.01.23;Aston Villa WFC;Tottenham Hotspur WFC;2;1;11;Women's Super League;2022/2023
15.01.23;Arsenal WFC;Chelsea FC Women;1;1;11;Women's Super League;2022/2023
15.01.23;Everton FC;Reading WFC;3;2;11;Women's Super League;2022/2023
15.01.23;Manchester United WFC;Liverpool FC Women;6;0;11;Women's Super League;2022/2023
15.01.23;Leicester City WFC;bri;3;0;11;Women's Super League;2022/2023
15.01.23;West Ham United WFC;Manchester City WFC;0;1;11;Women's Super League;2022/2023
21.01.23;Manchester City WFC;Aston Villa WFC;1;1;12;Women's Super League;2022/2023
22.01.23;Everton FC;West Ham United WFC;3;0;12;Women's Super League;2022/2023
22.01.23;Reading WFC;Manchester United WFC;0;1;12;Women's Super League;2022/2023
15.03.23;Tottenham Hotspur WFC;Leicester City WFC;1;0;12;Women's Super League;2022/2023
03.05.23;Chelsea FC Women;Liverpool FC Women;2;1;12;Women's Super League;2022/2023
10.05.23;Brighton & Hove Albion WFC;Arsenal WFC;0;4;12;Women's Super League;2022/2023
04.02.23;Leicester City WFC;Manchester City WFC;0;2;13;Women's Super League;2022/2023
04.02.23;Aston Villa WFC;Brighton & Hove Albion WFC;1;1;13;Women's Super League;2022/2023
05.02.23;Manchester United WFC;Everton FC;0;0;13;Women's Super League;2022/2023
05.02.23;Tottenham Hotspur WFC;Chelsea FC Women;2;3;13;Women's Super League;2022/2023
05.02.23;Liverpool FC Women;Reading WFC;2;0;13;Women's Super League;2022/2023
05.02.23;West Ham United WFC;Arsenal WFC;0;0;13;Women's Super League;2022/2023
05.03.23;Manchester United WFC;Leicester City WFC;5;1;14;Women's Super League;2022/2023
05.03.23;Everton FC;Aston Villa WFC;0;2;14;Women's Super League;2022/2023
05.03.23;Reading WFC;West Ham United WFC;2;1;14;Women's Super League;2022/2023
05.03.23;Manchester City WFC;Tottenham Hotspur WFC;3;1;14;Women's Super League;2022/2023
08.03.23;Arsenal WFC;Liverpool FC Women;2;0;14;Women's Super League;2022/2023
08.03.23;Chelsea FC Women;Brighton & Hove Albion WFC;3;1;14;Women's Super League;2022/2023
12.03.23;Chelsea FC Women;Manchester United WFC;1;0;15;Women's Super League;2022/2023
12.03.23;Brighton & Hove Albion WFC;Manchester City WFC;1;2;15;Women's Super League;2022/2023
12.03.23;Liverpool FC Women;Tottenham Hotspur WFC;2;1;15;Women's Super League;2022/2023
12.03.23;Leicester City WFC;Everton FC;0;0;15;Women's Super League;2022/2023
12.03.23;West Ham United WFC;Aston Villa WFC;1;2;15;Women's Super League;2022/2023
12.03.23;Arsenal WFC;Reading WFC;4;0;15;Women's Super League;2022/2023
24.03.23;Everton FC;Liverpool FC Women;1;1;16;Women's Super League;2022/2023
25.03.23;Tottenham Hotspur WFC;Arsenal WFC;1;5;16;Women's Super League;2022/2023
25.03.23;Manchester United WFC;West Ham United WFC;4;0;16;Women's Super League;2022/2023
26.03.23;Manchester City WFC;Chelsea FC Women;2;0;16;Women's Super League;2022/2023
26.03.23;Aston Villa WFC;Leicester City WFC;5;0;16;Women's Super League;2022/2023
26.03.23;Reading WFC;Brighton & Hove Albion WFC;2;2;16;Women's Super League;2022/2023
01.04.23;Brighton & Hove Albion WFC;Manchester United WFC;0;4;17;Women's Super League;2022/2023
02.04.23;Arsenal WFC;Manchester City WFC;2;1;17;Women's Super League;2022/2023
02.04.23;Everton FC;Tottenham Hotspur WFC;2;1;17;Women's Super League;2022/2023
02.04.23;Leicester City WFC;Reading WFC;2;1;17;Women's Super League;2022/2023
02.04.23;West Ham United WFC;Liverpool FC Women;0;0;17;Women's Super League;2022/2023
02.04.23;Aston Villa WFC;Chelsea FC Women;0;3;17;Women's Super League;2022/2023
19.04.23;Manchester United WFC;Arsenal WFC;1;0;18;Women's Super League;2022/2023
23.04.23;Liverpool FC Women;Brighton & Hove Albion WFC;2;1;18;Women's Super League;2022/2023
23.04.23;Reading WFC;Everton FC;2;3;18;Women's Super League;2022/2023
23.04.23;Tottenham Hotspur WFC;Aston Villa WFC;3;3;18;Women's Super League;2022/2023
23.04.23;Manchester City WFC;West Ham United WFC;6;2;18;Women's Super League;2022/2023
10.05.23;Chelsea FC Women;Leicester City WFC;6;0;18;Women's Super League;2022/2023
28.04.23;Aston Villa WFC;Manchester United WFC;2;3;19;Women's Super League;2022/2023
29.04.23;Leicester City WFC;Liverpool FC Women;4;0;19;Women's Super League;2022/2023
29.04.23;Tottenham Hotspur WFC;Brighton & Hove Albion WFC;2;2;19;Women's Super League;2022/2023
30.04.23;Manchester City WFC;Reading WFC;4;1;19;Women's Super League;2022/2023
17.05.23;Everton FC;Arsenal WFC;1;4;19;Women's Super League;2022/2023
17.05.23;West Ham United WFC;Chelsea FC Women;0;4;19;Women's Super League;2022/2023
05.05.23;Arsenal WFC;Leicester City WFC;1;0;20;Women's Super League;2022/2023
07.05.23;Manchester United WFC;Tottenham Hotspur WFC;3;0;20;Women's Super League;2022/2023
07.05.23;Brighton & Hove Albion WFC;West Ham United WFC;1;0;20;Women's Super League;2022/2023
07.05.23;Liverpool FC Women;Manchester City WFC;2;1;20;Women's Super League;2022/2023
07.05.23;Reading WFC;Aston Villa WFC;0;5;20;Women's Super League;2022/2023
07.05.23;Chelsea FC Women;Everton FC;7;0;20;Women's Super League;2022/2023
20.05.23;Tottenham Hotspur WFC;Reading WFC;4;1;21;Women's Super League;2022/2023
21.05.23;Chelsea FC Women;Arsenal WFC;2;0;21;Women's Super League;2022/2023
21.05.23;Everton FC;Brighton & Hove Albion WFC;2;1;21;Women's Super League;2022/2023
21.05.23;Aston Villa WFC;Liverpool FC Women;3;3;21;Women's Super League;2022/2023
21.05.23;Leicester City WFC;West Ham United WFC;1;2;21;Women's Super League;2022/2023
21.05.23;Manchester United WFC;Manchester City WFC;2;1;21;Women's Super League;2022/2023
27.05.23;Brighton & Hove Albion WFC;Leicester City WFC;0;1;22;Women's Super League;2022/2023
27.05.23;Arsenal WFC;Aston Villa WFC;0;2;22;Women's Super League;2022/2023
27.05.23;Liverpool FC Women;Manchester United WFC;0;1;22;Women's Super League;2022/2023
27.05.23;Reading WFC;Chelsea FC Women;0;3;22;Women's Super League;2022/2023
27.05.23;Manchester City WFC;Everton FC;3;2;22;Women's Super League;2022/2023
27.05.23;West Ham United WFC;Tottenham Hotspur WFC;2;2;22;Women's Super League;2022/2023
03.09.21;Manchester United WFC;Reading WFC;2;0;1;Women's Super League;2021/2022
04.09.21;Aston Villa WFC;Leicester City WFC;2;1;1;Women's Super League;2021/2022
04.09.21;Everton FC;Manchester City WFC;0;4;1;Women's Super League;2021/2022
04.09.21;Tottenham Hotspur WFC;Birmingham City WFC;1;0;1;Women's Super League;2021/2022
05.09.21;Arsenal WFC;Chelsea FC Women;3;2;1;Women's Super League;2021/2022
05.09.21;Brighton & Hove Albion WFC;West Ham United WFC;2;0;1;Women's Super League;2021/2022
11.09.21;West Ham United WFC;Aston Villa WFC;1;1;2;Women's Super League;2021/2022
12.09.21;Chelsea FC Women;Everton FC;4;0;2;Women's Super League;2021/2022
12.09.21;Birmingham City WFC;Brighton & Hove Albion WFC;0;5;2;Women's Super League;2021/2022
12.09.21;Reading WFC;Arsenal WFC;0;4;2;Women's Super League;2021/2022
12.09.21;Leicester City WFC;Manchester United WFC;1;3;2;Women's Super League;2021/2022
12.09.21;Manchester City WFC;Tottenham Hotspur WFC;1;2;2;Women's Super League;2021/2022
25.09.21;Everton FC;Birmingham City WFC;3;1;3;Women's Super League;2021/2022
26.09.21;Manchester United WFC;Chelsea FC Women;1;6;3;Women's Super League;2021/2022
26.09.21;Brighton & Hove Albion WFC;Aston Villa WFC;0;1;3;Women's Super League;2021/2022
26.09.21;Tottenham Hotspur WFC;Reading WFC;1;0;3;Women's Super League;2021/2022
26.09.21;West Ham United WFC;Leicester City WFC;4;0;3;Women's Super League;2021/2022
26.09.21;Arsenal WFC;Manchester City WFC;5;0;3;Women's Super League;2021/2022
02.10.21;Chelsea FC Women;Brighton & Hove Albion WFC;3;1;4;Women's Super League;2021/2022
02.10.21;Aston Villa WFC;Arsenal WFC;0;4;4;Women's Super League;2021/2022
03.10.21;Reading WFC;Everton FC;0;3;4;Women's Super League;2021/2022
03.10.21;Leicester City WFC;Tottenham Hotspur WFC;0;2;4;Women's Super League;2021/2022
03.10.21;Manchester City WFC;West Ham United WFC;0;2;4;Women's Super League;2021/2022
03.10.21;Birmingham City WFC;Manchester United WFC;0;2;4;Women's Super League;2021/2022
09.10.21;Manchester United WFC;Manchester City WFC;2;2;5;Women's Super League;2021/2022
10.10.21;Chelsea FC Women;Leicester City WFC;2;0;5;Women's Super League;2021/2022
10.10.21;Brighton & Hove Albion WFC;Tottenham Hotspur WFC;2;1;5;Women's Super League;2021/2022
10.10.21;Reading WFC;Aston Villa WFC;3;0;5;Women's Super League;2021/2022
10.10.21;Arsenal WFC;Everton FC;3;0;5;Women's Super League;2021/2022
10.10.21;West Ham United WFC;Birmingham City WFC;1;1;5;Women's Super League;2021/2022
06.11.21;Aston Villa WFC;Chelsea FC Women;0;1;6;Women's Super League;2021/2022
06.11.21;Everton FC;Brighton & Hove Albion WFC;0;1;6;Women's Super League;2021/2022
07.11.21;Tottenham Hotspur WFC;Manchester United WFC;1;1;6;Women's Super League;2021/2022
07.11.21;Birmingham City WFC;Reading WFC;0;3;6;Women's Super League;2021/2022
07.11.21;Leicester City WFC;Manchester City WFC;1;4;6;Women's Super League;2021/2022
07.11.21;Arsenal WFC;West Ham United WFC;4;0;6;Women's Super League;2021/2022
13.11.21;Tottenham Hotspur WFC;Arsenal WFC;1;1;7;Women's Super League;2021/2022
14.11.21;Everton FC;Manchester United WFC;1;1;7;Women's Super League;2021/2022
14.11.21;Birmingham City WFC;Aston Villa WFC;0;1;7;Women's Super League;2021/2022
14.11.21;Brighton & Hove Albion WFC;Leicester City WFC;1;0;7;Women's Super League;2021/2022
14.11.21;Manchester City WFC;Chelsea FC Women;0;4;7;Women's Super League;2021/2022
14.11.21;West Ham United WFC;Reading WFC;2;2;7;Women's Super League;2021/2022
20.11.21;Manchester City WFC;Aston Villa WFC;5;0;8;Women's Super League;2021/2022
21.11.21;Manchester United WFC;Arsenal WFC;0;2;8;Women's Super League;2021/2022
21.11.21;Chelsea FC Women;Birmingham City WFC;5;0;8;Women's Super League;2021/2022
21.11.21;Reading WFC;Brighton & Hove Albion WFC;2;0;8;Women's Super League;2021/2022
21.11.21;Leicester City WFC;Everton FC;0;1;8;Women's Super League;2021/2022
21.11.21;West Ham United WFC;Tottenham Hotspur WFC;1;0;8;Women's Super League;2021/2022
11.12.21;Reading WFC;Chelsea FC Women;1;0;9;Women's Super League;2021/2022
12.12.21;Brighton & Hove Albion WFC;Manchester United WFC;0;2;9;Women's Super League;2021/2022
12.12.21;Everton FC;West Ham United WFC;1;1;9;Women's Super League;2021/2022
12.12.21;Birmingham City WFC;Manchester City WFC;2;3;9;Women's Super League;2021/2022
12.12.21;Aston Villa WFC;Tottenham Hotspur WFC;1;2;9;Women's Super League;2021/2022
12.12.21;Arsenal WFC;Leicester City WFC;4;0;9;Women's Super League;2021/2022
19.12.21;Manchester United WFC;Aston Villa WFC;5;0;10;Women's Super League;2021/2022
19.12.21;Leicester City WFC;Birmingham City WFC;2;0;10;Women's Super League;2021/2022
19.12.21;Tottenham Hotspur WFC;Everton FC;1;0;10;Women's Super League;2021/2022
26.01.22;Chelsea FC Women;West Ham United WFC;2;0;10;Women's Super League;2021/2022
27.01.22;Arsenal WFC;Brighton & Hove Albion WFC;2;1;10;Women's Super League;2021/2022
16.03.22;Manchester City WFC;Reading WFC;2;0;10;Women's Super League;2021/2022
09.01.22;Brighton & Hove Albion WFC;Manchester City WFC;0;6;11;Women's Super League;2021/2022
09.01.22;Birmingham City WFC;Arsenal WFC;2;0;11;Women's Super League;2021/2022
09.01.22;Reading WFC;Leicester City WFC;1;0;11;Women's Super League;2021/2022
02.03.22;Aston Villa WFC;Everton FC;0;1;11;Women's Super League;2021/2022
16.03.22;West Ham United WFC;Manchester United WFC;1;1;11;Women's Super League;2021/2022
28.04.22;Chelsea FC Women;Tottenham Hotspur WFC;2;1;11;Women's Super League;2021/2022
15.01.22;Manchester United WFC;Birmingham City WFC;5;0;12;Women's Super League;2021/2022
15.01.22;Aston Villa WFC;Manchester City WFC;0;3;12;Women's Super League;2021/2022
16.01.22;Leicester City WFC;Brighton & Hove Albion WFC;1;0;12;Women's Super League;2021/2022
16.01.22;Tottenham Hotspur WFC;West Ham United WFC;1;1;12;Women's Super League;2021/2022
02.03.22;Arsenal WFC;Reading WFC;4;0;12;Women's Super League;2021/2022
16.03.22;Everton FC;Chelsea FC Women;0;3;12;Women's Super League;2021/2022
23.01.22;Manchester United WFC;Tottenham Hotspur WFC;3;0;13;Women's Super League;2021/2022
23.01.22;Brighton & Hove Albion WFC;Chelsea FC Women;0;0;13;Women's Super League;2021/2022
23.01.22;Reading WFC;Birmingham City WFC;3;2;13;Women's Super League;2021/2022
23.01.22;Leicester City WFC;Aston Villa WFC;1;2;13;Women's Super League;2021/2022
23.01.22;West Ham United WFC;Everton FC;3;0;13;Women's Super League;2021/2022
23.01.22;Manchester City WFC;Arsenal WFC;1;1;13;Women's Super League;2021/2022
05.02.22;Arsenal WFC;Manchester United WFC;1;1;14;Women's Super League;2021/2022
06.02.22;Chelsea FC Women;Manchester City WFC;1;0;14;Women's Super League;2021/2022
06.02.22;Everton FC;Reading WFC;1;2;14;Women's Super League;2021/2022
06.02.22;Birmingham City WFC;Leicester City WFC;1;2;14;Women's Super League;2021/2022
06.02.22;Tottenham Hotspur WFC;Brighton & Hove Albion WFC;4;0;14;Women's Super League;2021/2022
06.02.22;Aston Villa WFC;West Ham United WFC;1;2;14;Women's Super League;2021/2022
11.02.22;Chelsea FC Women;Arsenal WFC;0;0;15;Women's Super League;2021/2022
13.02.22;Manchester City WFC;Manchester United WFC;1;0;15;Women's Super League;2021/2022
13.02.22;Everton FC;Aston Villa WFC;0;2;15;Women's Super League;2021/2022
13.02.22;Birmingham City WFC;Tottenham Hotspur WFC;0;2;15;Women's Super League;2021/2022
13.02.22;Brighton & Hove Albion WFC;Reading WFC;4;1;15;Women's Super League;2021/2022
13.02.22;Leicester City WFC;West Ham United WFC;3;0;15;Women's Super League;2021/2022
05.03.22;Aston Villa WFC;Brighton & Hove Albion WFC;0;1;16;Women's Super League;2021/2022
05.03.22;Manchester United WFC;Leicester City WFC;4;0;16;Women's Super League;2021/2022
06.03.22;Arsenal WFC;Birmingham City WFC;4;2;16;Women's Super League;2021/2022
06.03.22;Reading WFC;Tottenham Hotspur WFC;0;0;16;Women's Super League;2021/2022
10.03.22;West Ham United WFC;Chelsea FC Women;1;4;16;Women's Super League;2021/2022
23.03.22;Manchester City WFC;Everton FC;4;0;16;Women's Super League;2021/2022
12.03.22;Reading WFC;Manchester United WFC;1;3;17;Women's Super League;2021/2022
12.03.22;Everton FC;Leicester City WFC;3;2;17;Women's Super League;2021/2022
13.03.22;Tottenham Hotspur WFC;Manchester City WFC;0;1;17;Women's Super League;2021/2022
13.03.22;Chelsea FC Women;Aston Villa WFC;1;0;17;Women's Super League;2021/2022
13.03.22;Birmingham City WFC;West Ham United WFC;0;1;17;Women's Super League;2021/2022
13.03.22;Brighton & Hove Albion WFC;Arsenal WFC;0;3;17;Women's Super League;2021/2022
26.03.22;Aston Villa WFC;Reading WFC;1;1;18;Women's Super League;2021/2022
27.03.22;Manchester United WFC;Everton FC;3;1;18;Women's Super League;2021/2022
27.03.22;Leicester City WFC;Chelsea FC Women;0;9;18;Women's Super League;2021/2022
27.03.22;West Ham United WFC;Brighton & Hove Albion WFC;0;2;18;Women's Super League;2021/2022
04.05.22;Manchester City WFC;Birmingham City WFC;6;0;18;Women's Super League;2021/2022
04.05.22;Arsenal WFC;Tottenham Hotspur WFC;3;0;18;Women's Super League;2021/2022
01.04.22;Birmingham City WFC;Everton FC;0;0;19;Women's Super League;2021/2022
02.04.22;West Ham United WFC;Manchester City WFC;0;2;19;Women's Super League;2021/2022
03.04.22;Manchester United WFC;Brighton & Hove Albion WFC;1;0;19;Women's Super League;2021/2022
03.04.22;Leicester City WFC;Arsenal WFC;0;5;19;Women's Super League;2021/2022
03.04.22;Tottenham Hotspur WFC;Aston Villa WFC;0;1;19;Women's Super League;2021/2022
03.04.22;Chelsea FC Women;Reading WFC;5;0;19;Women's Super League;2021/2022
23.04.22;Brighton & Hove Albion WFC;Birmingham City WFC;1;3;20;Women's Super League;2021/2022
24.04.22;Reading WFC;West Ham United WFC;1;2;20;Women's Super League;2021/2022
24.04.22;Manchester City WFC;Leicester City WFC;4;0;20;Women's Super League;2021/2022
24.04.22;Tottenham Hotspur WFC;Chelsea FC Women;1;3;20;Women's Super League;2021/2022
24.04.22;Aston Villa WFC;Manchester United WFC;0;0;20;Women's Super League;2021/2022
24.04.22;Everton FC;Arsenal WFC;0;3;20;Women's Super League;2021/2022
30.04.22;Manchester City WFC;Brighton & Hove Albion WFC;7;2;21;Women's Super League;2021/2022
01.05.22;Manchester United WFC;West Ham United WFC;3;0;21;Women's Super League;2021/2022
01.05.22;Leicester City WFC;Reading WFC;0;0;21;Women's Super League;2021/2022
01.05.22;Arsenal WFC;Aston Villa WFC;7;0;21;Women's Super League;2021/2022
01.05.22;Birmingham City WFC;Chelsea FC Women;0;1;21;Women's Super League;2021/2022
01.05.22;Everton FC;Tottenham Hotspur WFC;2;2;21;Women's Super League;2021/2022
08.05.22;Aston Villa WFC;Birmingham City WFC;0;1;22;Women's Super League;2021/2022
08.05.22;Brighton & Hove Albion WFC;Everton FC;1;1;22;Women's Super League;2021/2022
08.05.22;Chelsea FC Women;Manchester United WFC;4;2;22;Women's Super League;2021/2022
08.05.22;Reading WFC;Manchester City WFC;0;4;22;Women's Super League;2021/2022
08.05.22;Tottenham Hotspur WFC;Leicester City WFC;1;0;22;Women's Super League;2021/2022
08.05.22;West Ham United WFC;Arsenal WFC;0;2;22;Women's Super League;2021/2022
05.09.25;Eintracht Frankfurt;SGS Essen;5;0;1;Google Pixel Frauen-Bundesliga;2025/2026
06.09.25;1. FC Köln;RB Leipzig;0;2;1;Google Pixel Frauen-Bundesliga;2025/2026
06.09.25;Bayern München;Bayer Leverkusen;2;0;1;Google Pixel Frauen-Bundesliga;2025/2026
07.09.25;Werder Bremen;SC Freiburg;1;1;1;Google Pixel Frauen-Bundesliga;2025/2026
07.09.25;Hamburger SV;VfL Wolfsburg;3;3;1;Google Pixel Frauen-Bundesliga;2025/2026
07.09.25;1. FC Union Berlin;1. FC Nürnberg;1;1;1;Google Pixel Frauen-Bundesliga;2025/2026
08.09.25;FC Carl Zeiss Jena;1899 Hoffenheim;1;4;1;Google Pixel Frauen-Bundesliga;2025/2026
12.09.25;SC Freiburg;1. FC Köln;1;0;2;Google Pixel Frauen-Bundesliga;2025/2026
13.09.25;1. FC Nürnberg;Werder Bremen;1;4;2;Google Pixel Frauen-Bundesliga;2025/2026
13.09.25;SGS Essen;Hamburger SV;0;0;2;Google Pixel Frauen-Bundesliga;2025/2026
14.09.25;RB Leipzig;Bayern München;0;3;2;Google Pixel Frauen-Bundesliga;2025/2026
14.09.25;VfL Wolfsburg;FC Carl Zeiss Jena;3;1;2;Google Pixel Frauen-Bundesliga;2025/2026
14.09.25;1899 Hoffenheim;Eintracht Frankfurt;3;0;2;Google Pixel Frauen-Bundesliga;2025/2026
15.09.25;Bayer Leverkusen;1. FC Union Berlin;3;2;2;Google Pixel Frauen-Bundesliga;2025/2026
19.09.25;SC Freiburg;Hamburger SV;6;2;3;Google Pixel Frauen-Bundesliga;2025/2026
20.09.25;1. FC Union Berlin;SGS Essen;2;0;3;Google Pixel Frauen-Bundesliga;2025/2026
20.09.25;Bayern München;FC Carl Zeiss Jena;0;0;3;Google Pixel Frauen-Bundesliga;2025/2026
21.09.25;Werder Bremen;1899 Hoffenheim;2;1;3;Google Pixel Frauen-Bundesliga;2025/2026
21.09.25;1. FC Nürnberg;Bayer Leverkusen;0;1;3;Google Pixel Frauen-Bundesliga;2025/2026
21.09.25;1. FC Köln;VfL Wolfsburg;1;2;3;Google Pixel Frauen-Bundesliga;2025/2026
22.09.25;Eintracht Frankfurt;RB Leipzig;4;3;3;Google Pixel Frauen-Bundesliga;2025/2026
23.09.25;Bayern München;SC Freiburg;4;0;4;Google Pixel Frauen-Bundesliga;2025/2026
23.09.25;FC Carl Zeiss Jena;1. FC Union Berlin;1;2;4;Google Pixel Frauen-Bundesliga;2025/2026
24.09.25;SGS Essen;1. FC Köln;1;2;4;Google Pixel Frauen-Bundesliga;2025/2026
24.09.25;1899 Hoffenheim;1. FC Nürnberg;1;1;4;Google Pixel Frauen-Bundesliga;2025/2026
24.09.25;VfL Wolfsburg;Werder Bremen;4;2;4;Google Pixel Frauen-Bundesliga;2025/2026
25.09.25;RB Leipzig;Hamburger SV;0;1;4;Google Pixel Frauen-Bundesliga;2025/2026
25.09.25;Bayer Leverkusen;Eintracht Frankfurt;2;1;4;Google Pixel Frauen-Bundesliga;2025/2026
03.10.25;Eintracht Frankfurt;FC Carl Zeiss Jena;3;1;5;Google Pixel Frauen-Bundesliga;2025/2026
04.10.25;SGS Essen;VfL Wolfsburg;0;8;5;Google Pixel Frauen-Bundesliga;2025/2026
04.10.25;Bayern München;Werder Bremen;4;0;5;Google Pixel Frauen-Bundesliga;2025/2026
05.10.25;1. FC Union Berlin;SC Freiburg;0;3;5;Google Pixel Frauen-Bundesliga;2025/2026
05.10.25;1. FC Nürnberg;RB Leipzig;1;1;5;Google Pixel Frauen-Bundesliga;2025/2026
06.10.25;Hamburger SV;1899 Hoffenheim;1;4;5;Google Pixel Frauen-Bundesliga;2025/2026
16.10.25;1. FC Köln;Bayer Leverkusen;2;2;5;Google Pixel Frauen-Bundesliga;2025/2026
10.10.25;RB Leipzig;SGS Essen;2;1;6;Google Pixel Frauen-Bundesliga;2025/2026
11.10.25;VfL Wolfsburg;Bayern München;1;3;6;Google Pixel Frauen-Bundesliga;2025/2026
11.10.25;Werder Bremen;Hamburger SV;2;0;6;Google Pixel Frauen-Bundesliga;2025/2026
12.10.25;SC Freiburg;Eintracht Frankfurt;3;2;6;Google Pixel Frauen-Bundesliga;2025/2026
12.10.25;1899 Hoffenheim;Bayer Leverkusen;0;2;6;Google Pixel Frauen-Bundesliga;2025/2026
12.10.25;1. FC Köln;1. FC Union Berlin;2;1;6;Google Pixel Frauen-Bundesliga;2025/2026
13.10.25;FC Carl Zeiss Jena;1. FC Nürnberg;2;3;6;Google Pixel Frauen-Bundesliga;2025/2026
17.10.25;SGS Essen;1899 Hoffenheim;0;1;7;Google Pixel Frauen-Bundesliga;2025/2026
18.10.25;1. FC Nürnberg;SC Freiburg;3;2;7;Google Pixel Frauen-Bundesliga;2025/2026
18.10.25;Hamburger SV;FC Carl Zeiss Jena;1;1;7;Google Pixel Frauen-Bundesliga;2025/2026
19.10.25;1. FC Union Berlin;RB Leipzig;5;0;7;Google Pixel Frauen-Bundesliga;2025/2026
19.10.25;Eintracht Frankfurt;Werder Bremen;2;0;7;Google Pixel Frauen-Bundesliga;2025/2026
19.10.25;Bayern München;1. FC Köln;5;1;7;Google Pixel Frauen-Bundesliga;2025/2026
19.10.25;Bayer Leverkusen;VfL Wolfsburg;1;5;7;Google Pixel Frauen-Bundesliga;2025/2026
31.10.25;1. FC Köln;1. FC Nürnberg;3;0;8;Google Pixel Frauen-Bundesliga;2025/2026
01.11.25;Werder Bremen;1. FC Union Berlin;3;0;8;Google Pixel Frauen-Bundesliga;2025/2026
01.11.25;Bayern München;SGS Essen;4;1;8;Google Pixel Frauen-Bundesliga;2025/2026
01.11.25;VfL Wolfsburg;1899 Hoffenheim;2;1;8;Google Pixel Frauen-Bundesliga;2025/2026
02.11.25;FC Carl Zeiss Jena;Bayer Leverkusen;2;4;8;Google Pixel Frauen-Bundesliga;2025/2026
02.11.25;Hamburger SV;Eintracht Frankfurt;0;4;8;Google Pixel Frauen-Bundesliga;2025/2026
03.11.25;SC Freiburg;RB Leipzig;2;4;8;Google Pixel Frauen-Bundesliga;2025/2026
04.11.25;1. FC Nürnberg;Bayern München;0;6;9;Google Pixel Frauen-Bundesliga;2025/2026
04.11.25;1. FC Union Berlin;VfL Wolfsburg;1;4;9;Google Pixel Frauen-Bundesliga;2025/2026
05.11.25;SGS Essen;Werder Bremen;2;3;9;Google Pixel Frauen-Bundesliga;2025/2026
05.11.25;Eintracht Frankfurt;1. FC Köln;1;1;9;Google Pixel Frauen-Bundesliga;2025/2026
05.11.25;Bayer Leverkusen;Hamburger SV;2;1;9;Google Pixel Frauen-Bundesliga;2025/2026
06.11.25;1899 Hoffenheim;SC Freiburg;2;1;9;Google Pixel Frauen-Bundesliga;2025/2026
06.11.25;RB Leipzig;FC Carl Zeiss Jena;2;0;9;Google Pixel Frauen-Bundesliga;2025/2026
07.11.25;Bayern München;1. FC Union Berlin;4;0;10;Google Pixel Frauen-Bundesliga;2025/2026
08.11.25;VfL Wolfsburg;Eintracht Frankfurt;2;3;10;Google Pixel Frauen-Bundesliga;2025/2026
09.11.25;FC Carl Zeiss Jena;SGS Essen;1;1;10;Google Pixel Frauen-Bundesliga;2025/2026
09.11.25;Hamburger SV;1. FC Nürnberg;1;2;10;Google Pixel Frauen-Bundesliga;2025/2026
09.11.25;1. FC Köln;1899 Hoffenheim;1;0;10;Google Pixel Frauen-Bundesliga;2025/2026
09.11.25;Werder Bremen;RB Leipzig;2;1;10;Google Pixel Frauen-Bundesliga;2025/2026
10.11.25;SC Freiburg;Bayer Leverkusen;2;1;10;Google Pixel Frauen-Bundesliga;2025/2026
21.11.25;1. FC Union Berlin;Hamburger SV;1;1;11;Google Pixel Frauen-Bundesliga;2025/2026
22.11.25;SC Freiburg;FC Carl Zeiss Jena;3;0;11;Google Pixel Frauen-Bundesliga;2025/2026
22.11.25;Bayer Leverkusen;SGS Essen;0;1;11;Google Pixel Frauen-Bundesliga;2025/2026
23.11.25;RB Leipzig;VfL Wolfsburg;1;3;11;Google Pixel Frauen-Bundesliga;2025/2026
23.11.25;1899 Hoffenheim;Bayern München;1;5;11;Google Pixel Frauen-Bundesliga;2025/2026
23.11.25;Werder Bremen;1. FC Köln;1;1;11;Google Pixel Frauen-Bundesliga;2025/2026
10.12.25;1. FC Nürnberg;Eintracht Frankfurt;5;3;11;Google Pixel Frauen-Bundesliga;2025/2026
05.12.25;VfL Wolfsburg;SC Freiburg;3;1;12;Google Pixel Frauen-Bundesliga;2025/2026
06.12.25;FC Carl Zeiss Jena;Werder Bremen;0;1;12;Google Pixel Frauen-Bundesliga;2025/2026
06.12.25;Bayer Leverkusen;RB Leipzig;3;2;12;Google Pixel Frauen-Bundesliga;2025/2026
07.12.25;1899 Hoffenheim;1. FC Union Berlin;3;0;12;Google Pixel Frauen-Bundesliga;2025/2026
07.12.25;Eintracht Frankfurt;Bayern München;0;5;12;Google Pixel Frauen-Bundesliga;2025/2026
07.12.25;SGS Essen;1. FC Nürnberg;2;0;12;Google Pixel Frauen-Bundesliga;2025/2026
08.12.25;Hamburger SV;1. FC Köln;1;4;12;Google Pixel Frauen-Bundesliga;2025/2026
12.12.25;Werder Bremen;Bayer Leverkusen;1;0;13;Google Pixel Frauen-Bundesliga;2025/2026
13.12.25;SC Freiburg;SGS Essen;0;0;13;Google Pixel Frauen-Bundesliga;2025/2026
13.12.25;1. FC Nürnberg;VfL Wolfsburg;1;6;13;Google Pixel Frauen-Bundesliga;2025/2026
14.12.25;Bayern München;Hamburger SV;6;0;13;Google Pixel Frauen-Bundesliga;2025/2026
14.12.25;1. FC Köln;FC Carl Zeiss Jena;0;1;13;Google Pixel Frauen-Bundesliga;2025/2026
14.12.25;RB Leipzig;1899 Hoffenheim;2;3;13;Google Pixel Frauen-Bundesliga;2025/2026
15.12.25;1. FC Union Berlin;Eintracht Frankfurt;2;2;13;Google Pixel Frauen-Bundesliga;2025/2026
19.12.25;SGS Essen;Eintracht Frankfurt;1;4;14;Google Pixel Frauen-Bundesliga;2025/2026
20.12.25;1899 Hoffenheim;FC Carl Zeiss Jena;5;1;14;Google Pixel Frauen-Bundesliga;2025/2026
20.12.25;1. FC Nürnberg;1. FC Union Berlin;1;2;14;Google Pixel Frauen-Bundesliga;2025/2026
21.12.25;SC Freiburg;Werder Bremen;3;0;14;Google Pixel Frauen-Bundesliga;2025/2026
21.12.25;RB Leipzig;1. FC Köln;0;1;14;Google Pixel Frauen-Bundesliga;2025/2026
21.12.25;VfL Wolfsburg;Hamburger SV;3;1;14;Google Pixel Frauen-Bundesliga;2025/2026
22.12.25;Bayer Leverkusen;Bayern München;0;3;14;Google Pixel Frauen-Bundesliga;2025/2026
23.01.26;1. FC Union Berlin;Bayer Leverkusen;1;2;15;Google Pixel Frauen-Bundesliga;2025/2026
24.01.26;1. FC Köln;SC Freiburg;1;0;15;Google Pixel Frauen-Bundesliga;2025/2026
25.01.26;Werder Bremen;1. FC Nürnberg;1;1;15;Google Pixel Frauen-Bundesliga;2025/2026
25.01.26;Hamburger SV;SGS Essen;2;1;15;Google Pixel Frauen-Bundesliga;2025/2026
25.01.26;Bayern München;RB Leipzig;3;0;15;Google Pixel Frauen-Bundesliga;2025/2026
18.03.26;FC Carl Zeiss Jena;VfL Wolfsburg;0;2;15;Google Pixel Frauen-Bundesliga;2025/2026
18.03.26;Eintracht Frankfurt;1899 Hoffenheim;2;0;15;Google Pixel Frauen-Bundesliga;2025/2026
31.01.26;Bayer Leverkusen;1. FC Nürnberg;4;0;16;Google Pixel Frauen-Bundesliga;2025/2026
31.01.26;SGS Essen;1. FC Union Berlin;2;4;16;Google Pixel Frauen-Bundesliga;2025/2026
01.02.26;Hamburger SV;SC Freiburg;0;2;16;Google Pixel Frauen-Bundesliga;2025/2026
01.02.26;1899 Hoffenheim;Werder Bremen;0;0;16;Google Pixel Frauen-Bundesliga;2025/2026
01.02.26;RB Leipzig;Eintracht Frankfurt;2;2;16;Google Pixel Frauen-Bundesliga;2025/2026
02.02.26;VfL Wolfsburg;1. FC Köln;2;1;16;Google Pixel Frauen-Bundesliga;2025/2026
11.02.26;FC Carl Zeiss Jena;Bayern München;0;6;16;Google Pixel Frauen-Bundesliga;2025/2026
06.02.26;SC Freiburg;Bayern München;1;4;17;Google Pixel Frauen-Bundesliga;2025/2026
07.02.26;Eintracht Frankfurt;Bayer Leverkusen;1;0;17;Google Pixel Frauen-Bundesliga;2025/2026
08.02.26;Hamburger SV;RB Leipzig;1;3;17;Google Pixel Frauen-Bundesliga;2025/2026
08.02.26;1. FC Union Berlin;FC Carl Zeiss Jena;1;2;17;Google Pixel Frauen-Bundesliga;2025/2026
08.02.26;1. FC Nürnberg;1899 Hoffenheim;0;3;17;Google Pixel Frauen-Bundesliga;2025/2026
09.02.26;1. FC Köln;SGS Essen;0;0;17;Google Pixel Frauen-Bundesliga;2025/2026
22.04.26;Werder Bremen;VfL Wolfsburg;0;0;17;Google Pixel Frauen-Bundesliga;2025/2026
13.02.26;Bayer Leverkusen;1. FC Köln;2;1;18;Google Pixel Frauen-Bundesliga;2025/2026
14.02.26;SC Freiburg;1. FC Union Berlin;1;1;18;Google Pixel Frauen-Bundesliga;2025/2026
14.02.26;RB Leipzig;1. FC Nürnberg;3;1;18;Google Pixel Frauen-Bundesliga;2025/2026
15.02.26;VfL Wolfsburg;SGS Essen;1;1;18;Google Pixel Frauen-Bundesliga;2025/2026
15.02.26;FC Carl Zeiss Jena;Eintracht Frankfurt;1;4;18;Google Pixel Frauen-Bundesliga;2025/2026
15.02.26;1899 Hoffenheim;Hamburger SV;0;4;18;Google Pixel Frauen-Bundesliga;2025/2026
29.04.26;Werder Bremen;Bayern München;0;2;18;Google Pixel Frauen-Bundesliga;2025/2026
20.02.26;1. FC Union Berlin;1. FC Köln;2;1;19;Google Pixel Frauen-Bundesliga;2025/2026
21.02.26;1. FC Nürnberg;FC Carl Zeiss Jena;5;1;19;Google Pixel Frauen-Bundesliga;2025/2026
21.02.26;Hamburger SV;Werder Bremen;1;1;19;Google Pixel Frauen-Bundesliga;2025/2026
22.02.26;Bayer Leverkusen;1899 Hoffenheim;0;1;19;Google Pixel Frauen-Bundesliga;2025/2026
22.02.26;Bayern München;VfL Wolfsburg;4;1;19;Google Pixel Frauen-Bundesliga;2025/2026
22.02.26;SGS Essen;RB Leipzig;2;2;19;Google Pixel Frauen-Bundesliga;2025/2026
23.02.26;Eintracht Frankfurt;SC Freiburg;3;0;19;Google Pixel Frauen-Bundesliga;2025/2026
13.03.26;SC Freiburg;1. FC Nürnberg;2;1;20;Google Pixel Frauen-Bundesliga;2025/2026
14.03.26;Werder Bremen;Eintracht Frankfurt;4;2;20;Google Pixel Frauen-Bundesliga;2025/2026
14.03.26;RB Leipzig;1. FC Union Berlin;2;2;20;Google Pixel Frauen-Bundesliga;2025/2026
15.03.26;1899 Hoffenheim;SGS Essen;4;0;20;Google Pixel Frauen-Bundesliga;2025/2026
15.03.26;FC Carl Zeiss Jena;Hamburger SV;1;1;20;Google Pixel Frauen-Bundesliga;2025/2026
15.03.26;1. FC Köln;Bayern München;0;3;20;Google Pixel Frauen-Bundesliga;2025/2026
15.03.26;VfL Wolfsburg;Bayer Leverkusen;2;1;20;Google Pixel Frauen-Bundesliga;2025/2026
20.03.26;SGS Essen;Bayern München;0;5;21;Google Pixel Frauen-Bundesliga;2025/2026
21.03.26;Eintracht Frankfurt;Hamburger SV;4;1;21;Google Pixel Frauen-Bundesliga;2025/2026
21.03.26;1899 Hoffenheim;VfL Wolfsburg;0;1;21;Google Pixel Frauen-Bundesliga;2025/2026
22.03.26;RB Leipzig;SC Freiburg;2;0;21;Google Pixel Frauen-Bundesliga;2025/2026
22.03.26;1. FC Nürnberg;1. FC Köln;1;2;21;Google Pixel Frauen-Bundesliga;2025/2026
22.03.26;Bayer Leverkusen;FC Carl Zeiss Jena;1;0;21;Google Pixel Frauen-Bundesliga;2025/2026
23.03.26;1. FC Union Berlin;Werder Bremen;4;1;21;Google Pixel Frauen-Bundesliga;2025/2026
27.03.26;FC Carl Zeiss Jena;RB Leipzig;1;1;22;Google Pixel Frauen-Bundesliga;2025/2026
28.03.26;Bayern München;1. FC Nürnberg;2;0;22;Google Pixel Frauen-Bundesliga;2025/2026
28.03.26;1. FC Köln;Eintracht Frankfurt;1;2;22;Google Pixel Frauen-Bundesliga;2025/2026
29.03.26;Werder Bremen;SGS Essen;2;1;22;Google Pixel Frauen-Bundesliga;2025/2026
29.03.26;VfL Wolfsburg;1. FC Union Berlin;3;3;22;Google Pixel Frauen-Bundesliga;2025/2026
29.03.26;SC Freiburg;1899 Hoffenheim;1;2;22;Google Pixel Frauen-Bundesliga;2025/2026
30.03.26;Hamburger SV;Bayer Leverkusen;1;3;22;Google Pixel Frauen-Bundesliga;2025/2026
22.04.26;1. FC Union Berlin;Bayern München;2;3;23;Google Pixel Frauen-Bundesliga;2025/2026
24.04.26;1. FC Nürnberg;Hamburger SV;0;1;23;Google Pixel Frauen-Bundesliga;2025/2026
25.04.26;SGS Essen;FC Carl Zeiss Jena;4;3;23;Google Pixel Frauen-Bundesliga;2025/2026
25.04.26;RB Leipzig;Werder Bremen;1;1;23;Google Pixel Frauen-Bundesliga;2025/2026
26.04.26;Eintracht Frankfurt;VfL Wolfsburg;3;1;23;Google Pixel Frauen-Bundesliga;2025/2026
26.04.26;Bayer Leverkusen;SC Freiburg;4;1;23;Google Pixel Frauen-Bundesliga;2025/2026
27.04.26;1899 Hoffenheim;1. FC Köln;6;2;23;Google Pixel Frauen-Bundesliga;2025/2026
01.05.26;Hamburger SV;1. FC Union Berlin;0;1;24;Google Pixel Frauen-Bundesliga;2025/2026
02.05.26;1. FC Köln;Werder Bremen;3;0;24;Google Pixel Frauen-Bundesliga;2025/2026
02.05.26;VfL Wolfsburg;RB Leipzig;3;2;24;Google Pixel Frauen-Bundesliga;2025/2026
03.05.26;SGS Essen;Bayer Leverkusen;0;4;24;Google Pixel Frauen-Bundesliga;2025/2026
03.05.26;FC Carl Zeiss Jena;SC Freiburg;1;5;24;Google Pixel Frauen-Bundesliga;2025/2026
04.05.26;Eintracht Frankfurt;1. FC Nürnberg;4;1;24;Google Pixel Frauen-Bundesliga;2025/2026
06.05.26;Bayern München;1899 Hoffenheim;1;1;24;Google Pixel Frauen-Bundesliga;2025/2026
08.05.26;1. FC Nürnberg;SGS Essen;3;0;25;Google Pixel Frauen-Bundesliga;2025/2026
09.05.26;1. FC Köln;Hamburger SV;2;1;25;Google Pixel Frauen-Bundesliga;2025/2026
09.05.26;SC Freiburg;VfL Wolfsburg;2;4;25;Google Pixel Frauen-Bundesliga;2025/2026
09.05.26;Bayern München;Eintracht Frankfurt;2;0;25;Google Pixel Frauen-Bundesliga;2025/2026
10.05.26;Werder Bremen;FC Carl Zeiss Jena;7;0;25;Google Pixel Frauen-Bundesliga;2025/2026
10.05.26;1. FC Union Berlin;1899 Hoffenheim;0;2;25;Google Pixel Frauen-Bundesliga;2025/2026
11.06.26;RB Leipzig;Bayer Leverkusen;1;3;25;Google Pixel Frauen-Bundesliga;2025/2026
17.05.26;SGS Essen;SC Freiburg;1;1;26;Google Pixel Frauen-Bundesliga;2025/2026
17.05.26;FC Carl Zeiss Jena;1. FC Köln;0;3;26;Google Pixel Frauen-Bundesliga;2025/2026
17.05.26;1899 Hoffenheim;RB Leipzig;0;0;26;Google Pixel Frauen-Bundesliga;2025/2026
17.05.26;Hamburger SV;Bayern München;0;1;26;Google Pixel Frauen-Bundesliga;2025/2026
17.05.26;VfL Wolfsburg;1. FC Nürnberg;3;1;26;Google Pixel Frauen-Bundesliga;2025/2026
17.05.26;Eintracht Frankfurt;1. FC Union Berlin;4;2;26;Google Pixel Frauen-Bundesliga;2025/2026
17.05.26;Bayer Leverkusen;Werder Bremen;1;3;26;Google Pixel Frauen-Bundesliga;2025/2026
15.09.23;SC Freiburg;Bayern München;2;2;1;Google Pixel Frauen-Bundesliga;2023/2024
16.09.23;1899 Hoffenheim;MSV Duisburg;9;0;1;Google Pixel Frauen-Bundesliga;2023/2024
16.09.23;1. FC Nürnberg;Werder Bremen;1;5;1;Google Pixel Frauen-Bundesliga;2023/2024
17.09.23;1. FC Köln;RB Leipzig;2;1;1;Google Pixel Frauen-Bundesliga;2023/2024
17.09.23;VfL Wolfsburg;Bayer Leverkusen;3;0;1;Google Pixel Frauen-Bundesliga;2023/2024
17.09.23;SGS Essen;Eintracht Frankfurt;2;0;1;Google Pixel Frauen-Bundesliga;2023/2024
29.09.23;RB Leipzig;SGS Essen;3;2;2;Google Pixel Frauen-Bundesliga;2023/2024
30.09.23;Bayer Leverkusen;1. FC Nürnberg;6;0;2;Google Pixel Frauen-Bundesliga;2023/2024
30.09.23;Werder Bremen;1899 Hoffenheim;1;3;2;Google Pixel Frauen-Bundesliga;2023/2024
01.10.23;Eintracht Frankfurt;VfL Wolfsburg;2;4;2;Google Pixel Frauen-Bundesliga;2023/2024
01.10.23;MSV Duisburg;SC Freiburg;2;2;2;Google Pixel Frauen-Bundesliga;2023/2024
02.10.23;Bayern München;1. FC Köln;2;0;2;Google Pixel Frauen-Bundesliga;2023/2024
06.10.23;VfL Wolfsburg;1. FC Nürnberg;1;0;3;Google Pixel Frauen-Bundesliga;2023/2024
07.10.23;1. FC Köln;MSV Duisburg;4;1;3;Google Pixel Frauen-Bundesliga;2023/2024
07.10.23;Eintracht Frankfurt;RB Leipzig;3;1;3;Google Pixel Frauen-Bundesliga;2023/2024
08.10.23;SGS Essen;Bayern München;0;2;3;Google Pixel Frauen-Bundesliga;2023/2024
08.10.23;SC Freiburg;Werder Bremen;2;1;3;Google Pixel Frauen-Bundesliga;2023/2024
09.10.23;1899 Hoffenheim;Bayer Leverkusen;2;2;3;Google Pixel Frauen-Bundesliga;2023/2024
13.10.23;1. FC Nürnberg;1899 Hoffenheim;0;3;4;Google Pixel Frauen-Bundesliga;2023/2024
14.10.23;Werder Bremen;1. FC Köln;3;0;4;Google Pixel Frauen-Bundesliga;2023/2024
14.10.23;Bayern München;Eintracht Frankfurt;0;0;4;Google Pixel Frauen-Bundesliga;2023/2024
15.10.23;RB Leipzig;VfL Wolfsburg;0;2;4;Google Pixel Frauen-Bundesliga;2023/2024
15.10.23;Bayer Leverkusen;SC Freiburg;3;0;4;Google Pixel Frauen-Bundesliga;2023/2024
16.10.23;MSV Duisburg;SGS Essen;0;1;4;Google Pixel Frauen-Bundesliga;2023/2024
20.10.23;1. FC Köln;Bayer Leverkusen;0;1;5;Google Pixel Frauen-Bundesliga;2023/2024
21.10.23;SC Freiburg;1. FC Nürnberg;0;2;5;Google Pixel Frauen-Bundesliga;2023/2024
21.10.23;SGS Essen;Werder Bremen;1;1;5;Google Pixel Frauen-Bundesliga;2023/2024
22.10.23;VfL Wolfsburg;1899 Hoffenheim;2;2;5;Google Pixel Frauen-Bundesliga;2023/2024
22.10.23;Eintracht Frankfurt;MSV Duisburg;5;1;5;Google Pixel Frauen-Bundesliga;2023/2024
22.10.23;RB Leipzig;Bayern München;0;3;5;Google Pixel Frauen-Bundesliga;2023/2024
03.11.23;MSV Duisburg;RB Leipzig;1;1;6;Google Pixel Frauen-Bundesliga;2023/2024
04.11.23;1899 Hoffenheim;SC Freiburg;2;3;6;Google Pixel Frauen-Bundesliga;2023/2024
04.11.23;Bayer Leverkusen;SGS Essen;0;0;6;Google Pixel Frauen-Bundesliga;2023/2024
05.11.23;Bayern München;VfL Wolfsburg;2;1;6;Google Pixel Frauen-Bundesliga;2023/2024
05.11.23;1. FC Nürnberg;1. FC Köln;1;3;6;Google Pixel Frauen-Bundesliga;2023/2024
06.11.23;Werder Bremen;Eintracht Frankfurt;0;1;6;Google Pixel Frauen-Bundesliga;2023/2024
10.11.23;Eintracht Frankfurt;Bayer Leverkusen;2;2;7;Google Pixel Frauen-Bundesliga;2023/2024
11.11.23;RB Leipzig;Werder Bremen;0;5;7;Google Pixel Frauen-Bundesliga;2023/2024
11.11.23;SGS Essen;1. FC Nürnberg;5;0;7;Google Pixel Frauen-Bundesliga;2023/2024
12.11.23;VfL Wolfsburg;SC Freiburg;4;0;7;Google Pixel Frauen-Bundesliga;2023/2024
12.11.23;Bayern München;MSV Duisburg;2;0;7;Google Pixel Frauen-Bundesliga;2023/2024
13.11.23;1. FC Köln;1899 Hoffenheim;1;2;7;Google Pixel Frauen-Bundesliga;2023/2024
17.11.23;1899 Hoffenheim;SGS Essen;0;3;8;Google Pixel Frauen-Bundesliga;2023/2024
18.11.23;1. FC Nürnberg;Eintracht Frankfurt;0;2;8;Google Pixel Frauen-Bundesliga;2023/2024
18.11.23;VfL Wolfsburg;MSV Duisburg;2;0;8;Google Pixel Frauen-Bundesliga;2023/2024
19.11.23;Bayer Leverkusen;RB Leipzig;1;1;8;Google Pixel Frauen-Bundesliga;2023/2024
19.11.23;Werder Bremen;Bayern München;0;2;8;Google Pixel Frauen-Bundesliga;2023/2024
20.11.23;SC Freiburg;1. FC Köln;3;3;8;Google Pixel Frauen-Bundesliga;2023/2024
08.12.23;RB Leipzig;1. FC Nürnberg;0;0;9;Google Pixel Frauen-Bundesliga;2023/2024
09.12.23;SGS Essen;SC Freiburg;0;1;9;Google Pixel Frauen-Bundesliga;2023/2024
09.12.23;1. FC Köln;VfL Wolfsburg;1;4;9;Google Pixel Frauen-Bundesliga;2023/2024
10.12.23;Eintracht Frankfurt;1899 Hoffenheim;3;1;9;Google Pixel Frauen-Bundesliga;2023/2024
10.12.23;MSV Duisburg;Werder Bremen;0;2;9;Google Pixel Frauen-Bundesliga;2023/2024
11.12.23;Bayern München;Bayer Leverkusen;3;0;9;Google Pixel Frauen-Bundesliga;2023/2024
15.12.23;Bayer Leverkusen;MSV Duisburg;4;1;10;Google Pixel Frauen-Bundesliga;2023/2024
16.12.23;1. FC Köln;SGS Essen;0;1;10;Google Pixel Frauen-Bundesliga;2023/2024
16.12.23;SC Freiburg;Eintracht Frankfurt;0;4;10;Google Pixel Frauen-Bundesliga;2023/2024
17.12.23;1899 Hoffenheim;RB Leipzig;2;1;10;Google Pixel Frauen-Bundesliga;2023/2024
17.12.23;1. FC Nürnberg;Bayern München;1;1;10;Google Pixel Frauen-Bundesliga;2023/2024
18.12.23;VfL Wolfsburg;Werder Bremen;1;0;10;Google Pixel Frauen-Bundesliga;2023/2024
26.01.24;Werder Bremen;Bayer Leverkusen;2;1;11;Google Pixel Frauen-Bundesliga;2023/2024
27.01.24;RB Leipzig;SC Freiburg;0;2;11;Google Pixel Frauen-Bundesliga;2023/2024
27.01.24;Bayern München;1899 Hoffenheim;1;0;11;Google Pixel Frauen-Bundesliga;2023/2024
28.01.24;Eintracht Frankfurt;1. FC Köln;1;0;11;Google Pixel Frauen-Bundesliga;2023/2024
28.01.24;MSV Duisburg;1. FC Nürnberg;1;2;11;Google Pixel Frauen-Bundesliga;2023/2024
29.01.24;SGS Essen;VfL Wolfsburg;1;3;11;Google Pixel Frauen-Bundesliga;2023/2024
02.02.24;MSV Duisburg;1899 Hoffenheim;0;2;12;Google Pixel Frauen-Bundesliga;2023/2024
03.02.24;RB Leipzig;1. FC Köln;2;1;12;Google Pixel Frauen-Bundesliga;2023/2024
03.02.24;Werder Bremen;1. FC Nürnberg;4;0;12;Google Pixel Frauen-Bundesliga;2023/2024
04.02.24;Bayer Leverkusen;VfL Wolfsburg;1;1;12;Google Pixel Frauen-Bundesliga;2023/2024
04.02.24;Eintracht Frankfurt;SGS Essen;1;0;12;Google Pixel Frauen-Bundesliga;2023/2024
05.02.24;Bayern München;SC Freiburg;4;0;12;Google Pixel Frauen-Bundesliga;2023/2024
09.02.24;SGS Essen;RB Leipzig;4;4;13;Google Pixel Frauen-Bundesliga;2023/2024
10.02.24;1899 Hoffenheim;Werder Bremen;1;1;13;Google Pixel Frauen-Bundesliga;2023/2024
10.02.24;1. FC Köln;Bayern München;0;5;13;Google Pixel Frauen-Bundesliga;2023/2024
11.02.24;VfL Wolfsburg;Eintracht Frankfurt;3;0;13;Google Pixel Frauen-Bundesliga;2023/2024
11.02.24;SC Freiburg;MSV Duisburg;1;1;13;Google Pixel Frauen-Bundesliga;2023/2024
12.02.24;1. FC Nürnberg;Bayer Leverkusen;1;2;13;Google Pixel Frauen-Bundesliga;2023/2024
16.02.24;RB Leipzig;Eintracht Frankfurt;2;1;14;Google Pixel Frauen-Bundesliga;2023/2024
17.02.24;1. FC Nürnberg;VfL Wolfsburg;1;9;14;Google Pixel Frauen-Bundesliga;2023/2024
17.02.24;Werder Bremen;SC Freiburg;0;3;14;Google Pixel Frauen-Bundesliga;2023/2024
18.02.24;Bayer Leverkusen;1899 Hoffenheim;1;2;14;Google Pixel Frauen-Bundesliga;2023/2024
18.02.24;Bayern München;SGS Essen;2;0;14;Google Pixel Frauen-Bundesliga;2023/2024
18.02.24;MSV Duisburg;1. FC Köln;0;0;14;Google Pixel Frauen-Bundesliga;2023/2024
08.03.24;SGS Essen;MSV Duisburg;4;1;15;Google Pixel Frauen-Bundesliga;2023/2024
09.03.24;Eintracht Frankfurt;Bayern München;1;2;15;Google Pixel Frauen-Bundesliga;2023/2024
09.03.24;1899 Hoffenheim;1. FC Nürnberg;2;0;15;Google Pixel Frauen-Bundesliga;2023/2024
10.03.24;1. FC Köln;Werder Bremen;2;1;15;Google Pixel Frauen-Bundesliga;2023/2024
10.03.24;SC Freiburg;Bayer Leverkusen;0;0;15;Google Pixel Frauen-Bundesliga;2023/2024
11.03.24;VfL Wolfsburg;RB Leipzig;4;0;15;Google Pixel Frauen-Bundesliga;2023/2024
15.03.24;1899 Hoffenheim;VfL Wolfsburg;2;1;16;Google Pixel Frauen-Bundesliga;2023/2024
16.03.24;Bayern München;RB Leipzig;5;0;16;Google Pixel Frauen-Bundesliga;2023/2024
16.03.24;Werder Bremen;SGS Essen;0;0;16;Google Pixel Frauen-Bundesliga;2023/2024
17.03.24;1. FC Nürnberg;SC Freiburg;0;0;16;Google Pixel Frauen-Bundesliga;2023/2024
17.03.24;MSV Duisburg;Eintracht Frankfurt;1;2;16;Google Pixel Frauen-Bundesliga;2023/2024
18.03.24;Bayer Leverkusen;1. FC Köln;2;0;16;Google Pixel Frauen-Bundesliga;2023/2024
22.03.24;SC Freiburg;1899 Hoffenheim;2;4;17;Google Pixel Frauen-Bundesliga;2023/2024
23.03.24;1. FC Köln;1. FC Nürnberg;3;4;17;Google Pixel Frauen-Bundesliga;2023/2024
23.03.24;VfL Wolfsburg;Bayern München;0;4;17;Google Pixel Frauen-Bundesliga;2023/2024
24.03.24;RB Leipzig;MSV Duisburg;3;0;17;Google Pixel Frauen-Bundesliga;2023/2024
24.03.24;SGS Essen;Bayer Leverkusen;0;0;17;Google Pixel Frauen-Bundesliga;2023/2024
25.03.24;Eintracht Frankfurt;Werder Bremen;2;0;17;Google Pixel Frauen-Bundesliga;2023/2024
12.04.24;Werder Bremen;RB Leipzig;1;1;18;Google Pixel Frauen-Bundesliga;2023/2024
13.04.24;SC Freiburg;VfL Wolfsburg;1;4;18;Google Pixel Frauen-Bundesliga;2023/2024
13.04.24;Bayer Leverkusen;Eintracht Frankfurt;2;0;18;Google Pixel Frauen-Bundesliga;2023/2024
14.04.24;1. FC Nürnberg;SGS Essen;0;4;18;Google Pixel Frauen-Bundesliga;2023/2024
14.04.24;MSV Duisburg;Bayern München;1;5;18;Google Pixel Frauen-Bundesliga;2023/2024
15.04.24;1899 Hoffenheim;1. FC Köln;1;1;18;Google Pixel Frauen-Bundesliga;2023/2024
19.04.24;RB Leipzig;Bayer Leverkusen;1;0;19;Google Pixel Frauen-Bundesliga;2023/2024
20.04.24;SGS Essen;1899 Hoffenheim;2;1;19;Google Pixel Frauen-Bundesliga;2023/2024
20.04.24;Eintracht Frankfurt;1. FC Nürnberg;4;1;19;Google Pixel Frauen-Bundesliga;2023/2024
21.04.24;1. FC Köln;SC Freiburg;2;0;19;Google Pixel Frauen-Bundesliga;2023/2024
21.04.24;MSV Duisburg;VfL Wolfsburg;1;4;19;Google Pixel Frauen-Bundesliga;2023/2024
22.04.24;Bayern München;Werder Bremen;3;0;19;Google Pixel Frauen-Bundesliga;2023/2024
03.05.24;VfL Wolfsburg;1. FC Köln;5;1;20;Google Pixel Frauen-Bundesliga;2023/2024
04.05.24;Bayer Leverkusen;Bayern München;1;2;20;Google Pixel Frauen-Bundesliga;2023/2024
04.05.24;1899 Hoffenheim;Eintracht Frankfurt;1;3;20;Google Pixel Frauen-Bundesliga;2023/2024
05.05.24;SC Freiburg;SGS Essen;0;1;20;Google Pixel Frauen-Bundesliga;2023/2024
05.05.24;Werder Bremen;MSV Duisburg;4;2;20;Google Pixel Frauen-Bundesliga;2023/2024
06.05.24;1. FC Nürnberg;RB Leipzig;0;1;20;Google Pixel Frauen-Bundesliga;2023/2024
10.05.24;RB Leipzig;1899 Hoffenheim;3;0;21;Google Pixel Frauen-Bundesliga;2023/2024
11.05.24;SGS Essen;1. FC Köln;2;1;21;Google Pixel Frauen-Bundesliga;2023/2024
11.05.24;MSV Duisburg;Bayer Leverkusen;1;3;21;Google Pixel Frauen-Bundesliga;2023/2024
12.05.24;Bayern München;1. FC Nürnberg;4;0;21;Google Pixel Frauen-Bundesliga;2023/2024
12.05.24;Werder Bremen;VfL Wolfsburg;0;3;21;Google Pixel Frauen-Bundesliga;2023/2024
13.05.24;Eintracht Frankfurt;SC Freiburg;4;2;21;Google Pixel Frauen-Bundesliga;2023/2024
20.05.24;1. FC Köln;Eintracht Frankfurt;0;1;22;Google Pixel Frauen-Bundesliga;2023/2024
20.05.24;1. FC Nürnberg;MSV Duisburg;2;1;22;Google Pixel Frauen-Bundesliga;2023/2024
20.05.24;Bayer Leverkusen;Werder Bremen;2;3;22;Google Pixel Frauen-Bundesliga;2023/2024
20.05.24;SC Freiburg;RB Leipzig;2;1;22;Google Pixel Frauen-Bundesliga;2023/2024
20.05.24;1899 Hoffenheim;Bayern München;1;4;22;Google Pixel Frauen-Bundesliga;2023/2024
20.05.24;VfL Wolfsburg;SGS Essen;6;0;22;Google Pixel Frauen-Bundesliga;2023/2024
16.09.22;Eintracht Frankfurt;Bayern München;0;0;1;Google Pixel Frauen-Bundesliga;2022/2023
17.09.22;VfL Wolfsburg;SGS Essen;4;0;1;Google Pixel Frauen-Bundesliga;2022/2023
18.09.22;1. FC Köln;1899 Hoffenheim;3;1;1;Google Pixel Frauen-Bundesliga;2022/2023
18.09.22;SV Meppen;SC Freiburg;1;2;1;Google Pixel Frauen-Bundesliga;2022/2023
18.09.22;MSV Duisburg;Bayer Leverkusen;0;1;1;Google Pixel Frauen-Bundesliga;2022/2023
18.09.22;Werder Bremen;Turbine Potsdam;1;1;1;Google Pixel Frauen-Bundesliga;2022/2023
23.09.22;Bayer Leverkusen;1. FC Köln;1;0;2;Google Pixel Frauen-Bundesliga;2022/2023
24.09.22;1899 Hoffenheim;VfL Wolfsburg;1;2;2;Google Pixel Frauen-Bundesliga;2022/2023
25.09.22;Turbine Potsdam;MSV Duisburg;0;3;2;Google Pixel Frauen-Bundesliga;2022/2023
25.09.22;Bayern München;Werder Bremen;3;0;2;Google Pixel Frauen-Bundesliga;2022/2023
25.09.22;SGS Essen;SV Meppen;1;0;2;Google Pixel Frauen-Bundesliga;2022/2023
25.09.22;SC Freiburg;Eintracht Frankfurt;2;4;2;Google Pixel Frauen-Bundesliga;2022/2023
30.09.22;VfL Wolfsburg;Bayer Leverkusen;6;1;3;Google Pixel Frauen-Bundesliga;2022/2023
01.10.22;1. FC Köln;Turbine Potsdam;4;2;3;Google Pixel Frauen-Bundesliga;2022/2023
02.10.22;SV Meppen;1899 Hoffenheim;0;2;3;Google Pixel Frauen-Bundesliga;2022/2023
02.10.22;Eintracht Frankfurt;Werder Bremen;3;1;3;Google Pixel Frauen-Bundesliga;2022/2023
02.10.22;MSV Duisburg;Bayern München;0;4;3;Google Pixel Frauen-Bundesliga;2022/2023
02.10.22;SC Freiburg;SGS Essen;5;2;3;Google Pixel Frauen-Bundesliga;2022/2023
14.10.22;1899 Hoffenheim;SC Freiburg;3;2;4;Google Pixel Frauen-Bundesliga;2022/2023
15.10.22;Turbine Potsdam;VfL Wolfsburg;0;2;4;Google Pixel Frauen-Bundesliga;2022/2023
16.10.22;Bayer Leverkusen;SV Meppen;0;1;4;Google Pixel Frauen-Bundesliga;2022/2023
16.10.22;Bayern München;1. FC Köln;4;0;4;Google Pixel Frauen-Bundesliga;2022/2023
16.10.22;SGS Essen;Eintracht Frankfurt;0;4;4;Google Pixel Frauen-Bundesliga;2022/2023
16.10.22;Werder Bremen;MSV Duisburg;0;0;4;Google Pixel Frauen-Bundesliga;2022/2023
21.10.22;SV Meppen;Turbine Potsdam;2;0;5;Google Pixel Frauen-Bundesliga;2022/2023
22.10.22;SC Freiburg;Bayer Leverkusen;3;2;5;Google Pixel Frauen-Bundesliga;2022/2023
23.10.22;SGS Essen;1899 Hoffenheim;2;3;5;Google Pixel Frauen-Bundesliga;2022/2023
23.10.22;VfL Wolfsburg;Bayern München;2;1;5;Google Pixel Frauen-Bundesliga;2022/2023
23.10.22;Eintracht Frankfurt;MSV Duisburg;3;2;5;Google Pixel Frauen-Bundesliga;2022/2023
23.10.22;1. FC Köln;Werder Bremen;2;0;5;Google Pixel Frauen-Bundesliga;2022/2023
28.10.22;MSV Duisburg;1. FC Köln;2;1;6;Google Pixel Frauen-Bundesliga;2022/2023
29.10.22;1899 Hoffenheim;Eintracht Frankfurt;3;3;6;Google Pixel Frauen-Bundesliga;2022/2023
30.10.22;Turbine Potsdam;SC Freiburg;0;5;6;Google Pixel Frauen-Bundesliga;2022/2023
30.10.22;Bayern München;SV Meppen;3;1;6;Google Pixel Frauen-Bundesliga;2022/2023
30.10.22;Bayer Leverkusen;SGS Essen;6;0;6;Google Pixel Frauen-Bundesliga;2022/2023
30.10.22;Werder Bremen;VfL Wolfsburg;2;3;6;Google Pixel Frauen-Bundesliga;2022/2023
04.11.22;1899 Hoffenheim;Bayer Leverkusen;3;1;7;Google Pixel Frauen-Bundesliga;2022/2023
05.11.22;SC Freiburg;Bayern München;0;3;7;Google Pixel Frauen-Bundesliga;2022/2023
06.11.22;VfL Wolfsburg;MSV Duisburg;4;0;7;Google Pixel Frauen-Bundesliga;2022/2023
06.11.22;SGS Essen;Turbine Potsdam;2;1;7;Google Pixel Frauen-Bundesliga;2022/2023
06.11.22;Eintracht Frankfurt;1. FC Köln;2;0;7;Google Pixel Frauen-Bundesliga;2022/2023
06.11.22;SV Meppen;Werder Bremen;2;0;7;Google Pixel Frauen-Bundesliga;2022/2023
25.11.22;Turbine Potsdam;1899 Hoffenheim;1;3;8;Google Pixel Frauen-Bundesliga;2022/2023
26.11.22;Eintracht Frankfurt;Bayer Leverkusen;1;0;8;Google Pixel Frauen-Bundesliga;2022/2023
26.11.22;Werder Bremen;SC Freiburg;1;2;8;Google Pixel Frauen-Bundesliga;2022/2023
27.11.22;1. FC Köln;VfL Wolfsburg;0;4;8;Google Pixel Frauen-Bundesliga;2022/2023
27.11.22;MSV Duisburg;SV Meppen;1;0;8;Google Pixel Frauen-Bundesliga;2022/2023
27.11.22;Bayern München;SGS Essen;2;0;8;Google Pixel Frauen-Bundesliga;2022/2023
02.12.22;1899 Hoffenheim;Bayern München;0;4;9;Google Pixel Frauen-Bundesliga;2022/2023
03.12.22;VfL Wolfsburg;Eintracht Frankfurt;5;0;9;Google Pixel Frauen-Bundesliga;2022/2023
03.12.22;SC Freiburg;MSV Duisburg;4;1;9;Google Pixel Frauen-Bundesliga;2022/2023
04.12.22;Bayer Leverkusen;Turbine Potsdam;3;0;9;Google Pixel Frauen-Bundesliga;2022/2023
04.12.22;SV Meppen;1. FC Köln;1;0;9;Google Pixel Frauen-Bundesliga;2022/2023
04.12.22;SGS Essen;Werder Bremen;0;0;9;Google Pixel Frauen-Bundesliga;2022/2023
09.12.22;Eintracht Frankfurt;Turbine Potsdam;3;0;10;Google Pixel Frauen-Bundesliga;2022/2023
10.12.22;Bayern München;Bayer Leverkusen;2;0;10;Google Pixel Frauen-Bundesliga;2022/2023
11.12.22;VfL Wolfsburg;SV Meppen;3;0;10;Google Pixel Frauen-Bundesliga;2022/2023
11.12.22;1. FC Köln;SC Freiburg;0;0;10;Google Pixel Frauen-Bundesliga;2022/2023
11.12.22;MSV Duisburg;SGS Essen;0;6;10;Google Pixel Frauen-Bundesliga;2022/2023
11.12.22;Werder Bremen;1899 Hoffenheim;1;1;10;Google Pixel Frauen-Bundesliga;2022/2023
03.02.23;SGS Essen;1. FC Köln;4;0;11;Google Pixel Frauen-Bundesliga;2022/2023
04.02.23;SC Freiburg;VfL Wolfsburg;0;4;11;Google Pixel Frauen-Bundesliga;2022/2023
05.02.23;1899 Hoffenheim;MSV Duisburg;7;0;11;Google Pixel Frauen-Bundesliga;2022/2023
05.02.23;Bayer Leverkusen;Werder Bremen;0;2;11;Google Pixel Frauen-Bundesliga;2022/2023
05.02.23;SV Meppen;Eintracht Frankfurt;0;1;11;Google Pixel Frauen-Bundesliga;2022/2023
25.02.23;Turbine Potsdam;Bayern München;0;3;11;Google Pixel Frauen-Bundesliga;2022/2023
11.02.23;Bayern München;Eintracht Frankfurt;2;1;12;Google Pixel Frauen-Bundesliga;2022/2023
12.02.23;SGS Essen;VfL Wolfsburg;0;3;12;Google Pixel Frauen-Bundesliga;2022/2023
12.02.23;SC Freiburg;SV Meppen;3;1;12;Google Pixel Frauen-Bundesliga;2022/2023
12.02.23;1899 Hoffenheim;1. FC Köln;4;0;12;Google Pixel Frauen-Bundesliga;2022/2023
12.02.23;Bayer Leverkusen;MSV Duisburg;2;0;12;Google Pixel Frauen-Bundesliga;2022/2023
01.03.23;Turbine Potsdam;Werder Bremen;1;2;12;Google Pixel Frauen-Bundesliga;2022/2023
03.03.23;Eintracht Frankfurt;SC Freiburg;4;1;13;Google Pixel Frauen-Bundesliga;2022/2023
04.03.23;VfL Wolfsburg;1899 Hoffenheim;1;2;13;Google Pixel Frauen-Bundesliga;2022/2023
05.03.23;MSV Duisburg;Turbine Potsdam;3;0;13;Google Pixel Frauen-Bundesliga;2022/2023
05.03.23;1. FC Köln;Bayer Leverkusen;0;0;13;Google Pixel Frauen-Bundesliga;2022/2023
05.03.23;SV Meppen;SGS Essen;1;1;13;Google Pixel Frauen-Bundesliga;2022/2023
05.03.23;Werder Bremen;Bayern München;0;2;13;Google Pixel Frauen-Bundesliga;2022/2023
10.03.23;Bayern München;MSV Duisburg;4;0;14;Google Pixel Frauen-Bundesliga;2022/2023
12.03.23;1899 Hoffenheim;SV Meppen;4;0;14;Google Pixel Frauen-Bundesliga;2022/2023
12.03.23;Bayer Leverkusen;VfL Wolfsburg;1;4;14;Google Pixel Frauen-Bundesliga;2022/2023
12.03.23;SGS Essen;SC Freiburg;2;1;14;Google Pixel Frauen-Bundesliga;2022/2023
14.03.23;Werder Bremen;Eintracht Frankfurt;0;2;14;Google Pixel Frauen-Bundesliga;2022/2023
21.03.23;Turbine Potsdam;1. FC Köln;0;0;14;Google Pixel Frauen-Bundesliga;2022/2023
17.03.23;VfL Wolfsburg;Turbine Potsdam;5;0;15;Google Pixel Frauen-Bundesliga;2022/2023
18.03.23;1. FC Köln;Bayern München;0;5;15;Google Pixel Frauen-Bundesliga;2022/2023
19.03.23;Eintracht Frankfurt;SGS Essen;4;1;15;Google Pixel Frauen-Bundesliga;2022/2023
19.03.23;MSV Duisburg;Werder Bremen;0;1;15;Google Pixel Frauen-Bundesliga;2022/2023
19.03.23;SV Meppen;Bayer Leverkusen;1;2;15;Google Pixel Frauen-Bundesliga;2022/2023
19.03.23;SC Freiburg;1899 Hoffenheim;0;1;15;Google Pixel Frauen-Bundesliga;2022/2023
24.03.23;Werder Bremen;1. FC Köln;1;0;16;Google Pixel Frauen-Bundesliga;2022/2023
25.03.23;Bayern München;VfL Wolfsburg;1;0;16;Google Pixel Frauen-Bundesliga;2022/2023
26.03.23;1899 Hoffenheim;SGS Essen;2;0;16;Google Pixel Frauen-Bundesliga;2022/2023
26.03.23;Bayer Leverkusen;SC Freiburg;2;0;16;Google Pixel Frauen-Bundesliga;2022/2023
26.03.23;Turbine Potsdam;SV Meppen;3;1;16;Google Pixel Frauen-Bundesliga;2022/2023
16.04.23;MSV Duisburg;Eintracht Frankfurt;0;1;16;Google Pixel Frauen-Bundesliga;2022/2023
31.03.23;1. FC Köln;MSV Duisburg;4;0;17;Google Pixel Frauen-Bundesliga;2022/2023
02.04.23;SC Freiburg;Turbine Potsdam;0;1;17;Google Pixel Frauen-Bundesliga;2022/2023
02.04.23;SV Meppen;Bayern München;0;2;17;Google Pixel Frauen-Bundesliga;2022/2023
02.04.23;VfL Wolfsburg;Werder Bremen;8;0;17;Google Pixel Frauen-Bundesliga;2022/2023
15.04.23;SGS Essen;Bayer Leverkusen;0;0;17;Google Pixel Frauen-Bundesliga;2022/2023
30.04.23;Eintracht Frankfurt;1899 Hoffenheim;3;3;17;Google Pixel Frauen-Bundesliga;2022/2023
19.04.23;MSV Duisburg;VfL Wolfsburg;0;3;18;Google Pixel Frauen-Bundesliga;2022/2023
21.04.23;Bayer Leverkusen;1899 Hoffenheim;0;1;18;Google Pixel Frauen-Bundesliga;2022/2023
22.04.23;Bayern München;SC Freiburg;8;2;18;Google Pixel Frauen-Bundesliga;2022/2023
23.04.23;1. FC Köln;Eintracht Frankfurt;0;2;18;Google Pixel Frauen-Bundesliga;2022/2023
23.04.23;Turbine Potsdam;SGS Essen;0;1;18;Google Pixel Frauen-Bundesliga;2022/2023
23.04.23;Werder Bremen;SV Meppen;0;0;18;Google Pixel Frauen-Bundesliga;2022/2023
06.05.23;Bayer Leverkusen;Eintracht Frankfurt;2;3;19;Google Pixel Frauen-Bundesliga;2022/2023
06.05.23;SGS Essen;Bayern München;1;2;19;Google Pixel Frauen-Bundesliga;2022/2023
07.05.23;VfL Wolfsburg;1. FC Köln;7;1;19;Google Pixel Frauen-Bundesliga;2022/2023
07.05.23;SC Freiburg;Werder Bremen;1;1;19;Google Pixel Frauen-Bundesliga;2022/2023
07.05.23;1899 Hoffenheim;Turbine Potsdam;6;1;19;Google Pixel Frauen-Bundesliga;2022/2023
07.05.23;SV Meppen;MSV Duisburg;0;2;19;Google Pixel Frauen-Bundesliga;2022/2023
12.05.23;Bayern München;1899 Hoffenheim;1;0;20;Google Pixel Frauen-Bundesliga;2022/2023
13.05.23;Turbine Potsdam;Bayer Leverkusen;1;5;20;Google Pixel Frauen-Bundesliga;2022/2023
14.05.23;Eintracht Frankfurt;VfL Wolfsburg;4;0;20;Google Pixel Frauen-Bundesliga;2022/2023
14.05.23;MSV Duisburg;SC Freiburg;1;1;20;Google Pixel Frauen-Bundesliga;2022/2023
14.05.23;Werder Bremen;SGS Essen;3;2;20;Google Pixel Frauen-Bundesliga;2022/2023
14.05.23;1. FC Köln;SV Meppen;1;2;20;Google Pixel Frauen-Bundesliga;2022/2023
19.05.23;1899 Hoffenheim;Werder Bremen;4;0;21;Google Pixel Frauen-Bundesliga;2022/2023
20.05.23;Bayer Leverkusen;Bayern München;0;0;21;Google Pixel Frauen-Bundesliga;2022/2023
21.05.23;Turbine Potsdam;Eintracht Frankfurt;0;3;21;Google Pixel Frauen-Bundesliga;2022/2023
21.05.23;SC Freiburg;1. FC Köln;1;3;21;Google Pixel Frauen-Bundesliga;2022/2023
21.05.23;SV Meppen;VfL Wolfsburg;2;3;21;Google Pixel Frauen-Bundesliga;2022/2023
21.05.23;SGS Essen;MSV Duisburg;0;0;21;Google Pixel Frauen-Bundesliga;2022/2023
28.05.23;Bayern München;Turbine Potsdam;11;1;22;Google Pixel Frauen-Bundesliga;2022/2023
28.05.23;Werder Bremen;Bayer Leverkusen;0;2;22;Google Pixel Frauen-Bundesliga;2022/2023
28.05.23;MSV Duisburg;1899 Hoffenheim;0;1;22;Google Pixel Frauen-Bundesliga;2022/2023
28.05.23;1. FC Köln;SGS Essen;1;1;22;Google Pixel Frauen-Bundesliga;2022/2023
28.05.23;VfL Wolfsburg;SC Freiburg;2;1;22;Google Pixel Frauen-Bundesliga;2022/2023
28.05.23;Eintracht Frankfurt;SV Meppen;6;0;22;Google Pixel Frauen-Bundesliga;2022/2023
27.08.21;1899 Hoffenheim;SC Freiburg;2;1;1;Google Pixel Frauen-Bundesliga;2021/2022
28.08.21;VfL Wolfsburg;Turbine Potsdam;3;0;1;Google Pixel Frauen-Bundesliga;2021/2022
28.08.21;SGS Essen;1. FC Köln;1;1;1;Google Pixel Frauen-Bundesliga;2021/2022
29.08.21;Eintracht Frankfurt;SC Sand;2;1;1;Google Pixel Frauen-Bundesliga;2021/2022
29.08.21;FC Carl Zeiss Jena;Bayer Leverkusen;0;3;1;Google Pixel Frauen-Bundesliga;2021/2022
29.08.21;Bayern München;Werder Bremen;8;0;1;Google Pixel Frauen-Bundesliga;2021/2022
03.09.21;Turbine Potsdam;FC Carl Zeiss Jena;5;0;2;Google Pixel Frauen-Bundesliga;2021/2022
04.09.21;SC Sand;Bayern München;0;3;2;Google Pixel Frauen-Bundesliga;2021/2022
04.09.21;Werder Bremen;VfL Wolfsburg;0;2;2;Google Pixel Frauen-Bundesliga;2021/2022
05.09.21;SC Freiburg;Eintracht Frankfurt;0;1;2;Google Pixel Frauen-Bundesliga;2021/2022
05.09.21;Bayer Leverkusen;SGS Essen;1;2;2;Google Pixel Frauen-Bundesliga;2021/2022
05.09.21;1. FC Köln;1899 Hoffenheim;1;2;2;Google Pixel Frauen-Bundesliga;2021/2022
10.09.21;Bayer Leverkusen;Turbine Potsdam;2;0;3;Google Pixel Frauen-Bundesliga;2021/2022
11.09.21;Eintracht Frankfurt;1. FC Köln;4;0;3;Google Pixel Frauen-Bundesliga;2021/2022
11.09.21;Bayern München;SC Freiburg;4;0;3;Google Pixel Frauen-Bundesliga;2021/2022
12.09.21;VfL Wolfsburg;SC Sand;4;0;3;Google Pixel Frauen-Bundesliga;2021/2022
12.09.21;FC Carl Zeiss Jena;Werder Bremen;1;1;3;Google Pixel Frauen-Bundesliga;2021/2022
12.09.21;SGS Essen;1899 Hoffenheim;0;0;3;Google Pixel Frauen-Bundesliga;2021/2022
01.10.21;1. FC Köln;Bayern München;0;6;4;Google Pixel Frauen-Bundesliga;2021/2022
02.10.21;SC Freiburg;VfL Wolfsburg;2;2;4;Google Pixel Frauen-Bundesliga;2021/2022
02.10.21;1899 Hoffenheim;Eintracht Frankfurt;2;1;4;Google Pixel Frauen-Bundesliga;2021/2022
03.10.21;SC Sand;FC Carl Zeiss Jena;0;0;4;Google Pixel Frauen-Bundesliga;2021/2022
03.10.21;Turbine Potsdam;SGS Essen;3;2;4;Google Pixel Frauen-Bundesliga;2021/2022
03.10.21;Werder Bremen;Bayer Leverkusen;0;3;4;Google Pixel Frauen-Bundesliga;2021/2022
08.10.21;Bayer Leverkusen;SC Sand;2;0;5;Google Pixel Frauen-Bundesliga;2021/2022
09.10.21;Bayern München;1899 Hoffenheim;3;1;5;Google Pixel Frauen-Bundesliga;2021/2022
10.10.21;Turbine Potsdam;Werder Bremen;5;0;5;Google Pixel Frauen-Bundesliga;2021/2022
10.10.21;FC Carl Zeiss Jena;SC Freiburg;1;5;5;Google Pixel Frauen-Bundesliga;2021/2022
10.10.21;SGS Essen;Eintracht Frankfurt;0;2;5;Google Pixel Frauen-Bundesliga;2021/2022
10.10.21;VfL Wolfsburg;1. FC Köln;3;0;5;Google Pixel Frauen-Bundesliga;2021/2022
15.10.21;Werder Bremen;SGS Essen;1;0;6;Google Pixel Frauen-Bundesliga;2021/2022
16.10.21;SC Freiburg;Bayer Leverkusen;1;2;6;Google Pixel Frauen-Bundesliga;2021/2022
17.10.21;SC Sand;Turbine Potsdam;0;1;6;Google Pixel Frauen-Bundesliga;2021/2022
17.10.21;1899 Hoffenheim;VfL Wolfsburg;2;1;6;Google Pixel Frauen-Bundesliga;2021/2022
17.10.21;Eintracht Frankfurt;Bayern München;3;2;6;Google Pixel Frauen-Bundesliga;2021/2022
17.10.21;1. FC Köln;FC Carl Zeiss Jena;2;0;6;Google Pixel Frauen-Bundesliga;2021/2022
05.11.21;VfL Wolfsburg;Eintracht Frankfurt;3;2;7;Google Pixel Frauen-Bundesliga;2021/2022
06.11.21;SGS Essen;Bayern München;1;2;7;Google Pixel Frauen-Bundesliga;2021/2022
07.11.21;Werder Bremen;SC Sand;1;0;7;Google Pixel Frauen-Bundesliga;2021/2022
07.11.21;FC Carl Zeiss Jena;1899 Hoffenheim;1;5;7;Google Pixel Frauen-Bundesliga;2021/2022
07.11.21;Turbine Potsdam;SC Freiburg;2;1;7;Google Pixel Frauen-Bundesliga;2021/2022
07.11.21;Bayer Leverkusen;1. FC Köln;3;4;7;Google Pixel Frauen-Bundesliga;2021/2022
12.11.21;Eintracht Frankfurt;FC Carl Zeiss Jena;6;0;8;Google Pixel Frauen-Bundesliga;2021/2022
13.11.21;Bayern München;VfL Wolfsburg;0;1;8;Google Pixel Frauen-Bundesliga;2021/2022
14.11.21;SC Freiburg;Werder Bremen;1;0;8;Google Pixel Frauen-Bundesliga;2021/2022
14.11.21;1899 Hoffenheim;Bayer Leverkusen;7;1;8;Google Pixel Frauen-Bundesliga;2021/2022
14.11.21;SGS Essen;SC Sand;4;1;8;Google Pixel Frauen-Bundesliga;2021/2022
14.11.21;1. FC Köln;Turbine Potsdam;1;3;8;Google Pixel Frauen-Bundesliga;2021/2022
19.11.21;Werder Bremen;1. FC Köln;0;0;9;Google Pixel Frauen-Bundesliga;2021/2022
20.11.21;SC Sand;SC Freiburg;0;2;9;Google Pixel Frauen-Bundesliga;2021/2022
21.11.21;Turbine Potsdam;1899 Hoffenheim;3;3;9;Google Pixel Frauen-Bundesliga;2021/2022
21.11.21;Bayern München;FC Carl Zeiss Jena;3;0;9;Google Pixel Frauen-Bundesliga;2021/2022
21.11.21;VfL Wolfsburg;SGS Essen;5;1;9;Google Pixel Frauen-Bundesliga;2021/2022
21.11.21;Bayer Leverkusen;Eintracht Frankfurt;0;1;9;Google Pixel Frauen-Bundesliga;2021/2022
03.12.21;Eintracht Frankfurt;Turbine Potsdam;3;3;10;Google Pixel Frauen-Bundesliga;2021/2022
04.12.21;Bayern München;Bayer Leverkusen;7;1;10;Google Pixel Frauen-Bundesliga;2021/2022
05.12.21;SGS Essen;SC Freiburg;0;1;10;Google Pixel Frauen-Bundesliga;2021/2022
05.12.21;VfL Wolfsburg;FC Carl Zeiss Jena;5;0;10;Google Pixel Frauen-Bundesliga;2021/2022
05.12.21;1899 Hoffenheim;Werder Bremen;7;1;10;Google Pixel Frauen-Bundesliga;2021/2022
05.12.21;1. FC Köln;SC Sand;1;0;10;Google Pixel Frauen-Bundesliga;2021/2022
10.12.21;SC Freiburg;1. FC Köln;2;2;11;Google Pixel Frauen-Bundesliga;2021/2022
11.12.21;Bayer Leverkusen;VfL Wolfsburg;1;1;11;Google Pixel Frauen-Bundesliga;2021/2022
12.12.21;SC Sand;1899 Hoffenheim;1;1;11;Google Pixel Frauen-Bundesliga;2021/2022
12.12.21;Turbine Potsdam;Bayern München;1;1;11;Google Pixel Frauen-Bundesliga;2021/2022
12.12.21;FC Carl Zeiss Jena;SGS Essen;0;4;11;Google Pixel Frauen-Bundesliga;2021/2022
12.12.21;Werder Bremen;Eintracht Frankfurt;1;0;11;Google Pixel Frauen-Bundesliga;2021/2022
17.12.21;1. FC Köln;SGS Essen;2;1;12;Google Pixel Frauen-Bundesliga;2021/2022
18.12.21;SC Freiburg;1899 Hoffenheim;1;3;12;Google Pixel Frauen-Bundesliga;2021/2022
19.12.21;SC Sand;Eintracht Frankfurt;0;2;12;Google Pixel Frauen-Bundesliga;2021/2022
19.12.21;Bayer Leverkusen;FC Carl Zeiss Jena;2;0;12;Google Pixel Frauen-Bundesliga;2021/2022
19.12.21;Werder Bremen;Bayern München;0;2;12;Google Pixel Frauen-Bundesliga;2021/2022
19.12.21;Turbine Potsdam;VfL Wolfsburg;0;3;12;Google Pixel Frauen-Bundesliga;2021/2022
04.02.22;1899 Hoffenheim;1. FC Köln;1;1;13;Google Pixel Frauen-Bundesliga;2021/2022
05.02.22;SGS Essen;Bayer Leverkusen;1;1;13;Google Pixel Frauen-Bundesliga;2021/2022
06.02.22;Eintracht Frankfurt;SC Freiburg;1;2;13;Google Pixel Frauen-Bundesliga;2021/2022
06.02.22;VfL Wolfsburg;Werder Bremen;3;1;13;Google Pixel Frauen-Bundesliga;2021/2022
06.02.22;Bayern München;SC Sand;4;0;13;Google Pixel Frauen-Bundesliga;2021/2022
06.02.22;FC Carl Zeiss Jena;Turbine Potsdam;0;6;13;Google Pixel Frauen-Bundesliga;2021/2022
11.02.22;Turbine Potsdam;Bayer Leverkusen;4;2;14;Google Pixel Frauen-Bundesliga;2021/2022
12.02.22;SC Freiburg;Bayern München;0;3;14;Google Pixel Frauen-Bundesliga;2021/2022
13.02.22;1899 Hoffenheim;SGS Essen;2;1;14;Google Pixel Frauen-Bundesliga;2021/2022
13.02.22;1. FC Köln;Eintracht Frankfurt;1;2;14;Google Pixel Frauen-Bundesliga;2021/2022
13.02.22;Werder Bremen;FC Carl Zeiss Jena;0;2;14;Google Pixel Frauen-Bundesliga;2021/2022
16.03.22;SC Sand;VfL Wolfsburg;1;2;14;Google Pixel Frauen-Bundesliga;2021/2022
04.03.22;Bayer Leverkusen;Werder Bremen;1;1;15;Google Pixel Frauen-Bundesliga;2021/2022
05.03.22;Eintracht Frankfurt;1899 Hoffenheim;3;2;15;Google Pixel Frauen-Bundesliga;2021/2022
06.03.22;VfL Wolfsburg;SC Freiburg;4;1;15;Google Pixel Frauen-Bundesliga;2021/2022
06.03.22;FC Carl Zeiss Jena;SC Sand;1;4;15;Google Pixel Frauen-Bundesliga;2021/2022
06.03.22;SGS Essen;Turbine Potsdam;0;5;15;Google Pixel Frauen-Bundesliga;2021/2022
06.03.22;Bayern München;1. FC Köln;6;0;15;Google Pixel Frauen-Bundesliga;2021/2022
11.03.22;1. FC Köln;VfL Wolfsburg;1;5;16;Google Pixel Frauen-Bundesliga;2021/2022
12.03.22;1899 Hoffenheim;Bayern München;2;4;16;Google Pixel Frauen-Bundesliga;2021/2022
13.03.22;Eintracht Frankfurt;SGS Essen;1;0;16;Google Pixel Frauen-Bundesliga;2021/2022
13.03.22;SC Sand;Bayer Leverkusen;2;1;16;Google Pixel Frauen-Bundesliga;2021/2022
13.03.22;Werder Bremen;Turbine Potsdam;0;5;16;Google Pixel Frauen-Bundesliga;2021/2022
13.03.22;SC Freiburg;FC Carl Zeiss Jena;7;1;16;Google Pixel Frauen-Bundesliga;2021/2022
18.03.22;Bayern München;Eintracht Frankfurt;4;2;17;Google Pixel Frauen-Bundesliga;2021/2022
19.03.22;VfL Wolfsburg;1899 Hoffenheim;3;0;17;Google Pixel Frauen-Bundesliga;2021/2022
20.03.22;Bayer Leverkusen;SC Freiburg;2;3;17;Google Pixel Frauen-Bundesliga;2021/2022
20.03.22;Turbine Potsdam;SC Sand;2;0;17;Google Pixel Frauen-Bundesliga;2021/2022
20.03.22;SGS Essen;Werder Bremen;0;0;17;Google Pixel Frauen-Bundesliga;2021/2022
20.03.22;FC Carl Zeiss Jena;1. FC Köln;1;3;17;Google Pixel Frauen-Bundesliga;2021/2022
25.03.22;SC Freiburg;Turbine Potsdam;0;0;18;Google Pixel Frauen-Bundesliga;2021/2022
26.03.22;Eintracht Frankfurt;VfL Wolfsburg;1;4;18;Google Pixel Frauen-Bundesliga;2021/2022
27.03.22;SC Sand;Werder Bremen;0;1;18;Google Pixel Frauen-Bundesliga;2021/2022
27.03.22;1. FC Köln;Bayer Leverkusen;1;1;18;Google Pixel Frauen-Bundesliga;2021/2022
27.03.22;Bayern München;SGS Essen;4;0;18;Google Pixel Frauen-Bundesliga;2021/2022
27.03.22;1899 Hoffenheim;FC Carl Zeiss Jena;6;0;18;Google Pixel Frauen-Bundesliga;2021/2022
01.04.22;FC Carl Zeiss Jena;Eintracht Frankfurt;0;4;19;Google Pixel Frauen-Bundesliga;2021/2022
02.04.22;Turbine Potsdam;1. FC Köln;2;0;19;Google Pixel Frauen-Bundesliga;2021/2022
03.04.22;SC Sand;SGS Essen;1;1;19;Google Pixel Frauen-Bundesliga;2021/2022
03.04.22;VfL Wolfsburg;Bayern München;6;0;19;Google Pixel Frauen-Bundesliga;2021/2022
03.04.22;Bayer Leverkusen;1899 Hoffenheim;0;3;19;Google Pixel Frauen-Bundesliga;2021/2022
03.04.22;Werder Bremen;SC Freiburg;0;0;19;Google Pixel Frauen-Bundesliga;2021/2022
22.04.22;FC Carl Zeiss Jena;Bayern München;0;4;20;Google Pixel Frauen-Bundesliga;2021/2022
23.04.22;1899 Hoffenheim;Turbine Potsdam;1;2;20;Google Pixel Frauen-Bundesliga;2021/2022
24.04.22;Eintracht Frankfurt;Bayer Leverkusen;2;1;20;Google Pixel Frauen-Bundesliga;2021/2022
24.04.22;1. FC Köln;Werder Bremen;1;1;20;Google Pixel Frauen-Bundesliga;2021/2022
24.04.22;SC Freiburg;SC Sand;7;1;20;Google Pixel Frauen-Bundesliga;2021/2022
04.05.22;SGS Essen;VfL Wolfsburg;1;5;20;Google Pixel Frauen-Bundesliga;2021/2022
06.05.22;Bayer Leverkusen;Bayern München;0;3;21;Google Pixel Frauen-Bundesliga;2021/2022
07.05.22;Turbine Potsdam;Eintracht Frankfurt;0;2;21;Google Pixel Frauen-Bundesliga;2021/2022
08.05.22;SC Freiburg;SGS Essen;3;0;21;Google Pixel Frauen-Bundesliga;2021/2022
08.05.22;SC Sand;1. FC Köln;1;0;21;Google Pixel Frauen-Bundesliga;2021/2022
08.05.22;FC Carl Zeiss Jena;VfL Wolfsburg;1;10;21;Google Pixel Frauen-Bundesliga;2021/2022
08.05.22;Werder Bremen;1899 Hoffenheim;0;1;21;Google Pixel Frauen-Bundesliga;2021/2022
15.05.22;1. FC Köln;SC Freiburg;0;0;22;Google Pixel Frauen-Bundesliga;2021/2022
15.05.22;1899 Hoffenheim;SC Sand;3;3;22;Google Pixel Frauen-Bundesliga;2021/2022
15.05.22;Eintracht Frankfurt;Werder Bremen;4;0;22;Google Pixel Frauen-Bundesliga;2021/2022
15.05.22;Bayern München;Turbine Potsdam;5;0;22;Google Pixel Frauen-Bundesliga;2021/2022
15.05.22;VfL Wolfsburg;Bayer Leverkusen;7;1;22;Google Pixel Frauen-Bundesliga;2021/2022
15.05.22;SGS Essen;FC Carl Zeiss Jena;3;0;22;Google Pixel Frauen-Bundesliga;2021/2022
04.09.21;FC Barcelona;Costa Adeje Tenerife;5;0;1;Primera División;2021/2022
04.09.21;Atlético Madrid;Rayo Vallecano;5;0;1;Primera División;2021/2022
05.09.21;SD Eibar;Sevilla FC;3;2;1;Primera División;2021/2022
05.09.21;Levante UD;Real Madrid;4;0;1;Primera División;2021/2022
05.09.21;Sporting de Huelva;Villarreal CF;0;0;1;Primera División;2021/2022
05.09.21;CD Alavés;Real Betis;2;1;1;Primera División;2021/2022
05.09.21;Real Sociedad;Valencia CF;4;1;1;Primera División;2021/2022
05.09.21;Madrid CFF;Athletic Club;0;2;1;Primera División;2021/2022
11.09.21;Real Betis;FC Barcelona;0;5;2;Primera División;2021/2022
12.09.21;Sevilla FC;Levante UD;0;0;2;Primera División;2021/2022
12.09.21;Villarreal CF;SD Eibar;1;0;2;Primera División;2021/2022
12.09.21;Valencia CF;Sporting de Huelva;2;2;2;Primera División;2021/2022
12.09.21;Athletic Club;Real Sociedad;0;1;2;Primera División;2021/2022
12.09.21;Rayo Vallecano;CD Alavés;1;2;2;Primera División;2021/2022
12.09.21;Real Madrid;Atlético Madrid;0;2;2;Primera División;2021/2022
12.09.21;Costa Adeje Tenerife;Madrid CFF;1;2;2;Primera División;2021/2022
25.09.21;SD Eibar;Athletic Club;1;2;3;Primera División;2021/2022
25.09.21;FC Barcelona;Valencia CF;8;0;3;Primera División;2021/2022
25.09.21;Real Sociedad;Sevilla FC;2;0;3;Primera División;2021/2022
25.09.21;CD Alavés;Villarreal CF;2;0;3;Primera División;2021/2022
25.09.21;Madrid CFF;Rayo Vallecano;4;2;3;Primera División;2021/2022
25.09.21;Costa Adeje Tenerife;Real Madrid;1;1;3;Primera División;2021/2022
26.09.21;Levante UD;Real Betis;1;1;3;Primera División;2021/2022
26.09.21;Sporting de Huelva;Atlético Madrid;0;3;3;Primera División;2021/2022
29.09.21;Rayo Vallecano;Sporting de Huelva;0;0;4;Primera División;2021/2022
29.09.21;Sevilla FC;Madrid CFF;2;2;4;Primera División;2021/2022
29.09.21;Villarreal CF;FC Barcelona;0;8;4;Primera División;2021/2022
29.09.21;Levante UD;SD Eibar;5;0;4;Primera División;2021/2022
29.09.21;Valencia CF;Athletic Club;1;3;4;Primera División;2021/2022
29.09.21;Real Madrid;Real Sociedad;0;1;4;Primera División;2021/2022
29.09.21;Atlético Madrid;CD Alavés;3;2;4;Primera División;2021/2022
29.09.21;Real Betis;Costa Adeje Tenerife;2;2;4;Primera División;2021/2022
02.10.21;FC Barcelona;CD Alavés;9;1;5;Primera División;2021/2022
03.10.21;SD Eibar;Rayo Vallecano;4;0;5;Primera División;2021/2022
03.10.21;Athletic Club;Real Madrid;2;0;5;Primera División;2021/2022
03.10.21;Sporting de Huelva;Real Betis;0;1;5;Primera División;2021/2022
03.10.21;Real Sociedad;Villarreal CF;4;0;5;Primera División;2021/2022
03.10.21;Valencia CF;Sevilla FC;1;2;5;Primera División;2021/2022
03.10.21;Madrid CFF;Atlético Madrid;2;2;5;Primera División;2021/2022
03.10.21;Costa Adeje Tenerife;Levante UD;2;0;5;Primera División;2021/2022
09.10.21;CD Alavés;Sporting de Huelva;0;0;6;Primera División;2021/2022
09.10.21;Atlético Madrid;FC Barcelona;0;3;6;Primera División;2021/2022
10.10.21;Real Betis;Madrid CFF;4;5;6;Primera División;2021/2022
10.10.21;Sevilla FC;Athletic Club;0;0;6;Primera División;2021/2022
10.10.21;Levante UD;Valencia CF;1;0;6;Primera División;2021/2022
10.10.21;Rayo Vallecano;Real Sociedad;1;3;6;Primera División;2021/2022
10.10.21;Real Madrid;SD Eibar;2;1;6;Primera División;2021/2022
10.11.21;Villarreal CF;Costa Adeje Tenerife;0;2;6;Primera División;2021/2022
16.10.21;Valencia CF;Rayo Vallecano;1;0;7;Primera División;2021/2022
16.10.21;Sevilla FC;Real Madrid;3;0;7;Primera División;2021/2022
17.10.21;SD Eibar;Real Betis;1;2;7;Primera División;2021/2022
17.10.21;Sporting de Huelva;FC Barcelona;0;5;7;Primera División;2021/2022
17.10.21;Madrid CFF;CD Alavés;0;1;7;Primera División;2021/2022
17.10.21;Costa Adeje Tenerife;Atlético Madrid;1;1;7;Primera División;2021/2022
17.10.21;Athletic Club;Villarreal CF;2;1;7;Primera División;2021/2022
17.10.21;Real Sociedad;Levante UD;0;1;7;Primera División;2021/2022
31.10.21;Real Betis;Athletic Club;4;2;8;Primera División;2021/2022
31.10.21;Levante UD;Sporting de Huelva;0;0;8;Primera División;2021/2022
31.10.21;Atlético Madrid;Villarreal CF;3;0;8;Primera División;2021/2022
31.10.21;CD Alavés;Costa Adeje Tenerife;1;1;8;Primera División;2021/2022
31.10.21;FC Barcelona;Real Sociedad;8;1;8;Primera División;2021/2022
31.10.21;Rayo Vallecano;Sevilla FC;1;0;8;Primera División;2021/2022
31.10.21;Real Madrid;Valencia CF;2;1;8;Primera División;2021/2022
31.10.21;Madrid CFF;SD Eibar;1;3;8;Primera División;2021/2022
06.11.21;Villarreal CF;Madrid CFF;0;3;9;Primera División;2021/2022
06.11.21;Sporting de Huelva;Costa Adeje Tenerife;0;3;9;Primera División;2021/2022
06.11.21;Real Madrid;Rayo Vallecano;1;0;9;Primera División;2021/2022
06.11.21;SD Eibar;FC Barcelona;0;3;9;Primera División;2021/2022
06.11.21;Athletic Club;Levante UD;2;3;9;Primera División;2021/2022
06.11.21;Real Sociedad;Real Betis;4;0;9;Primera División;2021/2022
06.11.21;Sevilla FC;CD Alavés;1;0;9;Primera División;2021/2022
07.11.21;Valencia CF;Atlético Madrid;1;1;9;Primera División;2021/2022
13.11.21;Atlético Madrid;Real Sociedad;0;1;10;Primera División;2021/2022
13.11.21;FC Barcelona;Levante UD;4;0;10;Primera División;2021/2022
13.11.21;Madrid CFF;Sporting de Huelva;2;1;10;Primera División;2021/2022
13.11.21;Real Betis;Real Madrid;1;4;10;Primera División;2021/2022
14.11.21;Villarreal CF;Sevilla FC;2;3;10;Primera División;2021/2022
14.11.21;Rayo Vallecano;Athletic Club;0;2;10;Primera División;2021/2022
14.11.21;CD Alavés;SD Eibar;1;0;10;Primera División;2021/2022
14.11.21;Costa Adeje Tenerife;Valencia CF;2;1;10;Primera División;2021/2022
20.11.21;Athletic Club;Sporting de Huelva;2;2;11;Primera División;2021/2022
20.11.21;Sevilla FC;FC Barcelona;1;10;11;Primera División;2021/2022
20.11.21;Levante UD;Madrid CFF;4;0;11;Primera División;2021/2022
21.11.21;Valencia CF;Real Betis;1;0;11;Primera División;2021/2022
21.11.21;Real Sociedad;Costa Adeje Tenerife;3;0;11;Primera División;2021/2022
21.11.21;SD Eibar;Atlético Madrid;0;3;11;Primera División;2021/2022
21.11.21;Rayo Vallecano;Villarreal CF;2;2;11;Primera División;2021/2022
21.11.21;Real Madrid;CD Alavés;1;1;11;Primera División;2021/2022
04.12.21;Real Betis;Sevilla FC;0;0;12;Primera División;2021/2022
04.12.21;FC Barcelona;Athletic Club;4;0;12;Primera División;2021/2022
04.12.21;Costa Adeje Tenerife;Rayo Vallecano;3;2;12;Primera División;2021/2022
04.12.21;Villarreal CF;Real Madrid;0;2;12;Primera División;2021/2022
05.12.21;Sporting de Huelva;SD Eibar;1;1;12;Primera División;2021/2022
05.12.21;Atlético Madrid;Levante UD;2;1;12;Primera División;2021/2022
05.12.21;CD Alavés;Valencia CF;3;1;12;Primera División;2021/2022
05.12.21;Madrid CFF;Real Sociedad;1;2;12;Primera División;2021/2022
11.12.21;Athletic Club;CD Alavés;4;1;13;Primera División;2021/2022
12.12.21;Levante UD;Villarreal CF;1;2;13;Primera División;2021/2022
12.12.21;Valencia CF;Madrid CFF;1;3;13;Primera División;2021/2022
12.12.21;SD Eibar;Costa Adeje Tenerife;0;2;13;Primera División;2021/2022
12.12.21;Rayo Vallecano;Real Betis;0;2;13;Primera División;2021/2022
12.12.21;Sevilla FC;Atlético Madrid;0;0;13;Primera División;2021/2022
12.12.21;Real Madrid;FC Barcelona;1;3;13;Primera División;2021/2022
12.12.21;Real Sociedad;Sporting de Huelva;2;2;13;Primera División;2021/2022
18.12.21;SD Eibar;Real Sociedad;2;3;14;Primera División;2021/2022
18.12.21;Atlético Madrid;Real Betis;6;1;14;Primera División;2021/2022
18.12.21;FC Barcelona;Rayo Vallecano;4;0;14;Primera División;2021/2022
18.12.21;Villarreal CF;Valencia CF;0;2;14;Primera División;2021/2022
18.12.21;Sporting de Huelva;Sevilla FC;0;0;14;Primera División;2021/2022
18.12.21;Costa Adeje Tenerife;Athletic Club;2;0;14;Primera División;2021/2022
19.12.21;Madrid CFF;Real Madrid;1;3;14;Primera División;2021/2022
19.12.21;CD Alavés;Levante UD;1;1;14;Primera División;2021/2022
22.12.21;Real Betis;Villarreal CF;0;1;15;Primera División;2021/2022
22.12.21;Real Madrid;Sporting de Huelva;3;0;15;Primera División;2021/2022
22.12.21;CD Alavés;Real Sociedad;0;4;15;Primera División;2021/2022
22.12.21;FC Barcelona;Madrid CFF;7;0;15;Primera División;2021/2022
22.12.21;Sevilla FC;Costa Adeje Tenerife;1;2;15;Primera División;2021/2022
22.12.21;Valencia CF;SD Eibar;2;0;15;Primera División;2021/2022
09.02.22;Levante UD;Rayo Vallecano;4;2;15;Primera División;2021/2022
09.02.22;Athletic Club;Atlético Madrid;2;1;15;Primera División;2021/2022
08.01.22;Villarreal CF;CD Alavés;3;1;16;Primera División;2021/2022
08.01.22;Madrid CFF;Sevilla FC;1;2;16;Primera División;2021/2022
08.01.22;Costa Adeje Tenerife;FC Barcelona;0;7;16;Primera División;2021/2022
09.01.22;Rayo Vallecano;SD Eibar;0;1;16;Primera División;2021/2022
09.01.22;Real Betis;Levante UD;1;0;16;Primera División;2021/2022
09.01.22;Sporting de Huelva;Valencia CF;2;0;16;Primera División;2021/2022
09.01.22;Real Sociedad;Athletic Club;1;0;16;Primera División;2021/2022
09.03.22;Atlético Madrid;Real Madrid;0;2;16;Primera División;2021/2022
12.01.22;Villarreal CF;Atlético Madrid;0;5;17;Primera División;2021/2022
12.01.22;SD Eibar;Levante UD;1;2;17;Primera División;2021/2022
12.01.22;FC Barcelona;Sporting de Huelva;5;0;17;Primera División;2021/2022
12.01.22;Sevilla FC;Rayo Vallecano;2;1;17;Primera División;2021/2022
12.01.22;Valencia CF;Real Sociedad;0;3;17;Primera División;2021/2022
12.01.22;CD Alavés;Madrid CFF;2;1;17;Primera División;2021/2022
12.01.22;Athletic Club;Real Betis;1;1;17;Primera División;2021/2022
19.03.22;Real Madrid;Costa Adeje Tenerife;2;0;17;Primera División;2021/2022
15.01.22;Madrid CFF;Villarreal CF;2;4;18;Primera División;2021/2022
16.01.22;Real Betis;SD Eibar;2;0;18;Primera División;2021/2022
16.01.22;Levante UD;Athletic Club;2;3;18;Primera División;2021/2022
16.01.22;Atlético Madrid;Sporting de Huelva;3;2;18;Primera División;2021/2022
16.01.22;Sevilla FC;Valencia CF;3;1;18;Primera División;2021/2022
16.01.22;Costa Adeje Tenerife;CD Alavés;1;0;18;Primera División;2021/2022
09.02.22;Real Sociedad;FC Barcelona;1;9;18;Primera División;2021/2022
20.04.22;Rayo Vallecano;Real Madrid;0;1;18;Primera División;2021/2022
29.01.22;FC Barcelona;Real Betis;4;0;19;Primera División;2021/2022
29.01.22;Villarreal CF;Real Sociedad;1;4;19;Primera División;2021/2022
29.01.22;Real Madrid;Sevilla FC;3;1;19;Primera División;2021/2022
30.01.22;Valencia CF;Costa Adeje Tenerife;1;2;19;Primera División;2021/2022
30.01.22;SD Eibar;Madrid CFF;2;1;19;Primera División;2021/2022
30.01.22;Athletic Club;Rayo Vallecano;2;1;19;Primera División;2021/2022
30.01.22;CD Alavés;Atlético Madrid;1;1;19;Primera División;2021/2022
30.01.22;Sporting de Huelva;Levante UD;1;1;19;Primera División;2021/2022
02.02.22;Real Betis;CD Alavés;4;1;20;Primera División;2021/2022
02.02.22;Costa Adeje Tenerife;Sporting de Huelva;1;0;20;Primera División;2021/2022
02.02.22;Atlético Madrid;Madrid CFF;3;2;20;Primera División;2021/2022
02.02.22;Sevilla FC;Villarreal CF;0;3;20;Primera División;2021/2022
02.02.22;Rayo Vallecano;Valencia CF;1;1;20;Primera División;2021/2022
02.02.22;Levante UD;FC Barcelona;1;4;20;Primera División;2021/2022
02.02.22;Real Sociedad;Real Madrid;1;3;20;Primera División;2021/2022
02.02.22;Athletic Club;SD Eibar;3;1;20;Primera División;2021/2022
06.02.22;Real Sociedad;Atlético Madrid;2;2;21;Primera División;2021/2022
06.02.22;CD Alavés;Sevilla FC;1;1;21;Primera División;2021/2022
06.02.22;FC Barcelona;SD Eibar;7;0;21;Primera División;2021/2022
06.02.22;Villarreal CF;Rayo Vallecano;1;0;21;Primera División;2021/2022
06.02.22;Sporting de Huelva;Athletic Club;2;0;21;Primera División;2021/2022
06.02.22;Madrid CFF;Costa Adeje Tenerife;0;1;21;Primera División;2021/2022
06.02.22;Real Madrid;Real Betis;1;0;21;Primera División;2021/2022
06.02.22;Valencia CF;Levante UD;2;0;21;Primera División;2021/2022
12.02.22;Real Betis;Sporting de Huelva;0;0;22;Primera División;2021/2022
13.02.22;SD Eibar;Real Madrid;0;2;22;Primera División;2021/2022
13.02.22;Levante UD;Real Sociedad;1;0;22;Primera División;2021/2022
13.02.22;Valencia CF;CD Alavés;1;0;22;Primera División;2021/2022
13.02.22;Athletic Club;FC Barcelona;0;3;22;Primera División;2021/2022
13.02.22;Atlético Madrid;Sevilla FC;5;0;22;Primera División;2021/2022
13.02.22;Rayo Vallecano;Madrid CFF;3;2;22;Primera División;2021/2022
13.02.22;Costa Adeje Tenerife;Villarreal CF;3;1;22;Primera División;2021/2022
05.03.22;Real Madrid;Athletic Club;2;0;23;Primera División;2021/2022
06.03.22;Atlético Madrid;Costa Adeje Tenerife;4;1;23;Primera División;2021/2022
06.03.22;CD Alavés;FC Barcelona;0;6;23;Primera División;2021/2022
06.03.22;Sporting de Huelva;Rayo Vallecano;1;1;23;Primera División;2021/2022
06.03.22;Madrid CFF;Valencia CF;1;0;23;Primera División;2021/2022
06.03.22;Real Sociedad;SD Eibar;2;1;23;Primera División;2021/2022
06.03.22;Sevilla FC;Real Betis;0;0;23;Primera División;2021/2022
20.03.22;Villarreal CF;Levante UD;0;2;23;Primera División;2021/2022
12.03.22;SD Eibar;Sporting de Huelva;1;2;24;Primera División;2021/2022
12.03.22;Athletic Club;Madrid CFF;2;1;24;Primera División;2021/2022
12.03.22;Real Betis;Real Sociedad;0;3;24;Primera División;2021/2022
13.03.22;Rayo Vallecano;Atlético Madrid;0;0;24;Primera División;2021/2022
13.03.22;FC Barcelona;Real Madrid;5;0;24;Primera División;2021/2022
13.03.22;Costa Adeje Tenerife;Sevilla FC;1;0;24;Primera División;2021/2022
30.03.22;Levante UD;CD Alavés;3;0;24;Primera División;2021/2022
30.03.22;Valencia CF;Villarreal CF;2;1;24;Primera División;2021/2022
26.03.22;Sevilla FC;SD Eibar;4;1;25;Primera División;2021/2022
26.03.22;Madrid CFF;FC Barcelona;1;2;25;Primera División;2021/2022
26.03.22;Real Madrid;Levante UD;1;0;25;Primera División;2021/2022
26.03.22;Atlético Madrid;Valencia CF;3;0;25;Primera División;2021/2022
26.03.22;CD Alavés;Rayo Vallecano;3;1;25;Primera División;2021/2022
26.03.22;Villarreal CF;Athletic Club;1;1;25;Primera División;2021/2022
27.03.22;Sporting de Huelva;Real Sociedad;1;2;25;Primera División;2021/2022
27.03.22;Costa Adeje Tenerife;Real Betis;0;0;25;Primera División;2021/2022
02.04.22;Athletic Club;Valencia CF;2;2;26;Primera División;2021/2022
02.04.22;FC Barcelona;Villarreal CF;6;1;26;Primera División;2021/2022
02.04.22;Real Sociedad;Madrid CFF;0;1;26;Primera División;2021/2022
02.04.22;Real Betis;Atlético Madrid;1;1;26;Primera División;2021/2022
03.04.22;Levante UD;Sevilla FC;3;0;26;Primera División;2021/2022
03.04.22;SD Eibar;CD Alavés;2;0;26;Primera División;2021/2022
03.04.22;Sporting de Huelva;Real Madrid;3;1;26;Primera División;2021/2022
03.04.22;Rayo Vallecano;Costa Adeje Tenerife;1;2;26;Primera División;2021/2022
16.04.22;Sevilla FC;Real Sociedad;1;2;27;Primera División;2021/2022
16.04.22;Valencia CF;FC Barcelona;0;2;27;Primera División;2021/2022
16.04.22;Costa Adeje Tenerife;SD Eibar;3;2;27;Primera División;2021/2022
17.04.22;CD Alavés;Real Madrid;0;1;27;Primera División;2021/2022
17.04.22;Rayo Vallecano;Levante UD;3;4;27;Primera División;2021/2022
17.04.22;Atlético Madrid;Athletic Club;3;0;27;Primera División;2021/2022
17.04.22;Villarreal CF;Sporting de Huelva;1;1;27;Primera División;2021/2022
17.04.22;Madrid CFF;Real Betis;2;2;27;Primera División;2021/2022
30.04.22;Real Betis;Valencia CF;0;0;28;Primera División;2021/2022
30.04.22;Athletic Club;Costa Adeje Tenerife;2;1;28;Primera División;2021/2022
01.05.22;Real Madrid;Madrid CFF;1;0;28;Primera División;2021/2022
01.05.22;Levante UD;Atlético Madrid;0;5;28;Primera División;2021/2022
01.05.22;SD Eibar;Villarreal CF;1;1;28;Primera División;2021/2022
01.05.22;Sporting de Huelva;CD Alavés;2;1;28;Primera División;2021/2022
01.05.22;Real Sociedad;Rayo Vallecano;4;0;28;Primera División;2021/2022
05.05.22;FC Barcelona;Sevilla FC;5;1;28;Primera División;2021/2022
07.05.22;CD Alavés;Athletic Club;1;3;29;Primera División;2021/2022
08.05.22;Atlético Madrid;SD Eibar;3;1;29;Primera División;2021/2022
08.05.22;Sevilla FC;Sporting de Huelva;3;1;29;Primera División;2021/2022
08.05.22;Valencia CF;Real Madrid;0;0;29;Primera División;2021/2022
08.05.22;Villarreal CF;Real Betis;2;0;29;Primera División;2021/2022
08.05.22;Costa Adeje Tenerife;Real Sociedad;1;1;29;Primera División;2021/2022
08.05.22;Madrid CFF;Levante UD;1;3;29;Primera División;2021/2022
08.05.22;Rayo Vallecano;FC Barcelona;1;6;29;Primera División;2021/2022
14.05.22;Real Betis;Rayo Vallecano;1;3;30;Primera División;2021/2022
14.05.22;Levante UD;Costa Adeje Tenerife;4;1;30;Primera División;2021/2022
15.05.22;Sporting de Huelva;Madrid CFF;2;0;30;Primera División;2021/2022
15.05.22;SD Eibar;Valencia CF;5;1;30;Primera División;2021/2022
15.05.22;Athletic Club;Sevilla FC;1;4;30;Primera División;2021/2022
15.05.22;FC Barcelona;Atlético Madrid;2;1;30;Primera División;2021/2022
15.05.22;Real Madrid;Villarreal CF;1;0;30;Primera División;2021/2022
15.05.22;Real Sociedad;CD Alavés;6;1;30;Primera División;2021/2022
01.11.22;Atlético Madrid;Real Sociedad;1;1;1;Primera División;2022/2023
01.11.22;Costa Adeje Tenerife;Athletic Club;0;2;1;Primera División;2022/2023
01.11.22;Alhama CF;Madrid CFF;0;3;1;Primera División;2022/2023
02.11.22;Sporting de Huelva;Sevilla FC;1;1;1;Primera División;2022/2023
02.11.22;Levante UD;CD Alavés;2;1;1;Primera División;2022/2023
02.11.22;Valencia CF;Real Betis;3;0;1;Primera División;2022/2023
03.11.22;Villarreal CF;Real Madrid;0;4;1;Primera División;2022/2023
03.11.22;Levante Las Planas;FC Barcelona;0;4;1;Primera División;2022/2023
17.09.22;CD Alavés;Madrid CFF;1;2;2;Primera División;2022/2023
17.09.22;FC Barcelona;Costa Adeje Tenerife;2;0;2;Primera División;2022/2023
17.09.22;Real Madrid;Valencia CF;2;0;2;Primera División;2022/2023
17.09.22;Real Sociedad;Villarreal CF;2;0;2;Primera División;2022/2023
17.09.22;Sevilla FC;Atlético Madrid;1;3;2;Primera División;2022/2023
18.09.22;Alhama CF;Levante UD;2;3;2;Primera División;2022/2023
18.09.22;Athletic Club;Sporting de Huelva;3;0;2;Primera División;2022/2023
18.09.22;Real Betis;Levante Las Planas;1;2;2;Primera División;2022/2023
24.09.22;Sporting de Huelva;Alhama CF;1;0;3;Primera División;2022/2023
24.09.22;Madrid CFF;Levante Las Planas;3;1;3;Primera División;2022/2023
24.09.22;Valencia CF;Sevilla FC;2;0;3;Primera División;2022/2023
24.09.22;Real Sociedad;Real Betis;2;2;3;Primera División;2022/2023
25.09.22;Atlético Madrid;CD Alavés;1;0;3;Primera División;2022/2023
25.09.22;Villarreal CF;FC Barcelona;1;4;3;Primera División;2022/2023
25.09.22;Levante UD;Athletic Club;2;0;3;Primera División;2022/2023
08.02.23;Costa Adeje Tenerife;Real Madrid;2;3;3;Primera División;2022/2023
01.10.22;Real Betis;Costa Adeje Tenerife;1;2;4;Primera División;2022/2023
01.10.22;CD Alavés;Villarreal CF;0;4;4;Primera División;2022/2023
01.10.22;Sporting de Huelva;Valencia CF;0;0;4;Primera División;2022/2023
01.10.22;FC Barcelona;Madrid CFF;7;0;4;Primera División;2022/2023
02.10.22;Levante Las Planas;Alhama CF;3;1;4;Primera División;2022/2023
02.10.22;Levante UD;Atlético Madrid;2;1;4;Primera División;2022/2023
02.10.22;Sevilla FC;Real Sociedad;2;2;4;Primera División;2022/2023
02.10.22;Athletic Club;Real Madrid;0;3;4;Primera División;2022/2023
15.10.22;Levante Las Planas;Levante UD;1;1;5;Primera División;2022/2023
15.10.22;Real Sociedad;Costa Adeje Tenerife;1;1;5;Primera División;2022/2023
15.10.22;Atlético Madrid;Sporting de Huelva;5;0;5;Primera División;2022/2023
15.10.22;Athletic Club;FC Barcelona;0;3;5;Primera División;2022/2023
16.10.22;Villarreal CF;Sevilla FC;0;5;5;Primera División;2022/2023
16.10.22;Real Madrid;CD Alavés;7;1;5;Primera División;2022/2023
16.10.22;Alhama CF;Valencia CF;0;1;5;Primera División;2022/2023
16.10.22;Madrid CFF;Real Betis;4;0;5;Primera División;2022/2023
22.10.22;Atlético Madrid;Madrid CFF;1;1;6;Primera División;2022/2023
22.10.22;CD Alavés;Athletic Club;1;1;6;Primera División;2022/2023
22.10.22;Sporting de Huelva;Real Sociedad;0;2;6;Primera División;2022/2023
22.10.22;Real Betis;FC Barcelona;0;3;6;Primera División;2022/2023
23.10.22;Levante UD;Real Madrid;2;2;6;Primera División;2022/2023
23.10.22;Costa Adeje Tenerife;Villarreal CF;2;0;6;Primera División;2022/2023
23.10.22;Valencia CF;Levante Las Planas;1;1;6;Primera División;2022/2023
23.10.22;Sevilla FC;Alhama CF;2;0;6;Primera División;2022/2023
29.10.22;Athletic Club;Atlético Madrid;1;4;7;Primera División;2022/2023
29.10.22;Madrid CFF;Costa Adeje Tenerife;2;0;7;Primera División;2022/2023
29.10.22;CD Alavés;Real Sociedad;1;5;7;Primera División;2022/2023
29.10.22;Alhama CF;Real Betis;0;2;7;Primera División;2022/2023
30.10.22;FC Barcelona;Levante UD;2;1;7;Primera División;2022/2023
30.10.22;Levante Las Planas;Sporting de Huelva;1;2;7;Primera División;2022/2023
30.10.22;Villarreal CF;Valencia CF;1;1;7;Primera División;2022/2023
30.10.22;Real Madrid;Sevilla FC;2;0;7;Primera División;2022/2023
05.11.22;Valencia CF;Athletic Club;1;2;8;Primera División;2022/2023
05.11.22;Real Sociedad;Madrid CFF;0;2;8;Primera División;2022/2023
05.11.22;Atlético Madrid;Alhama CF;1;0;8;Primera División;2022/2023
05.11.22;Levante UD;Sporting de Huelva;3;0;8;Primera División;2022/2023
06.11.22;Villarreal CF;Real Betis;0;3;8;Primera División;2022/2023
06.11.22;Costa Adeje Tenerife;CD Alavés;1;1;8;Primera División;2022/2023
06.11.22;Sevilla FC;Levante Las Planas;5;0;8;Primera División;2022/2023
06.11.22;Real Madrid;FC Barcelona;0;4;8;Primera División;2022/2023
19.11.22;Alhama CF;Costa Adeje Tenerife;1;0;9;Primera División;2022/2023
19.11.22;Madrid CFF;Villarreal CF;1;2;9;Primera División;2022/2023
19.11.22;Sporting de Huelva;Real Madrid;0;1;9;Primera División;2022/2023
19.11.22;Valencia CF;Levante UD;4;2;9;Primera División;2022/2023
19.11.22;Athletic Club;Real Sociedad;1;3;9;Primera División;2022/2023
20.11.22;FC Barcelona;CD Alavés;8;0;9;Primera División;2022/2023
20.11.22;Levante Las Planas;Atlético Madrid;1;2;9;Primera División;2022/2023
20.11.22;Real Betis;Sevilla FC;3;0;9;Primera División;2022/2023
26.11.22;Madrid CFF;Sporting de Huelva;2;3;10;Primera División;2022/2023
26.11.22;Levante UD;Sevilla FC;5;1;10;Primera División;2022/2023
26.11.22;Villarreal CF;Athletic Club;1;6;10;Primera División;2022/2023
26.11.22;Real Madrid;Alhama CF;5;1;10;Primera División;2022/2023
27.11.22;CD Alavés;Real Betis;3;1;10;Primera División;2022/2023
27.11.22;Costa Adeje Tenerife;Valencia CF;1;0;10;Primera División;2022/2023
27.11.22;Real Sociedad;Levante Las Planas;3;0;10;Primera División;2022/2023
27.11.22;Atlético Madrid;FC Barcelona;1;6;10;Primera División;2022/2023
03.12.22;FC Barcelona;Real Sociedad;2;1;11;Primera División;2022/2023
03.12.22;Sevilla FC;Costa Adeje Tenerife;2;2;11;Primera División;2022/2023
03.12.22;Athletic Club;Madrid CFF;0;2;11;Primera División;2022/2023
03.12.22;Levante Las Planas;Real Madrid;1;4;11;Primera División;2022/2023
04.12.22;Valencia CF;Atlético Madrid;0;1;11;Primera División;2022/2023
04.12.22;Sporting de Huelva;CD Alavés;2;2;11;Primera División;2022/2023
04.12.22;Alhama CF;Villarreal CF;0;1;11;Primera División;2022/2023
04.12.22;Real Betis;Levante UD;0;7;11;Primera División;2022/2023
10.12.22;Madrid CFF;Valencia CF;3;1;12;Primera División;2022/2023
10.12.22;FC Barcelona;Alhama CF;4;0;12;Primera División;2022/2023
11.12.22;CD Alavés;Sevilla FC;2;0;12;Primera División;2022/2023
11.12.22;Villarreal CF;Sporting de Huelva;2;3;12;Primera División;2022/2023
11.12.22;Costa Adeje Tenerife;Levante Las Planas;0;1;12;Primera División;2022/2023
11.12.22;Real Betis;Athletic Club;1;0;12;Primera División;2022/2023
11.12.22;Real Sociedad;Levante UD;3;4;12;Primera División;2022/2023
11.12.22;Real Madrid;Atlético Madrid;1;0;12;Primera División;2022/2023
17.12.22;Levante Las Planas;Villarreal CF;2;2;13;Primera División;2022/2023
17.12.22;Atlético Madrid;Real Betis;2;1;13;Primera División;2022/2023
17.12.22;Sevilla FC;Athletic Club;1;1;13;Primera División;2022/2023
17.12.22;Alhama CF;CD Alavés;3;1;13;Primera División;2022/2023
17.12.22;Levante UD;Madrid CFF;2;1;13;Primera División;2022/2023
18.12.22;Sporting de Huelva;Costa Adeje Tenerife;2;2;13;Primera División;2022/2023
01.02.23;Valencia CF;FC Barcelona;0;4;13;Primera División;2022/2023
01.02.23;Real Madrid;Real Sociedad;4;1;13;Primera División;2022/2023
07.01.23;CD Alavés;Valencia CF;4;1;14;Primera División;2022/2023
07.01.23;Villarreal CF;Levante UD;0;6;14;Primera División;2022/2023
07.01.23;Real Sociedad;Alhama CF;2;1;14;Primera División;2022/2023
07.01.23;FC Barcelona;Sevilla FC;4;0;14;Primera División;2022/2023
08.01.23;Athletic Club;Levante Las Planas;2;0;14;Primera División;2022/2023
08.01.23;Costa Adeje Tenerife;Atlético Madrid;1;1;14;Primera División;2022/2023
08.01.23;Real Betis;Sporting de Huelva;0;0;14;Primera División;2022/2023
08.01.23;Madrid CFF;Real Madrid;0;4;14;Primera División;2022/2023
14.01.23;Sporting de Huelva;FC Barcelona;0;3;15;Primera División;2022/2023
14.01.23;Levante Las Planas;CD Alavés;1;0;15;Primera División;2022/2023
14.01.23;Atlético Madrid;Villarreal CF;2;2;15;Primera División;2022/2023
15.01.23;Alhama CF;Athletic Club;2;1;15;Primera División;2022/2023
15.01.23;Valencia CF;Real Sociedad;2;1;15;Primera División;2022/2023
15.01.23;Levante UD;Costa Adeje Tenerife;2;0;15;Primera División;2022/2023
15.01.23;Real Madrid;Real Betis;4;0;15;Primera División;2022/2023
15.01.23;Sevilla FC;Madrid CFF;4;2;15;Primera División;2022/2023
24.01.23;Athletic Club;Levante UD;0;3;16;Primera División;2022/2023
24.01.23;Real Betis;Alhama CF;1;2;16;Primera División;2022/2023
24.01.23;Valencia CF;Villarreal CF;2;0;16;Primera División;2022/2023
25.01.23;FC Barcelona;Levante Las Planas;7;0;16;Primera División;2022/2023
25.01.23;CD Alavés;Real Madrid;1;3;16;Primera División;2022/2023
25.01.23;Madrid CFF;Atlético Madrid;2;2;16;Primera División;2022/2023
26.01.23;Costa Adeje Tenerife;Real Sociedad;2;1;16;Primera División;2022/2023
01.02.23;Sevilla FC;Sporting de Huelva;1;0;16;Primera División;2022/2023
28.01.23;Villarreal CF;CD Alavés;1;0;17;Primera División;2022/2023
28.01.23;Real Betis;Madrid CFF;1;3;17;Primera División;2022/2023
28.01.23;Levante UD;Alhama CF;3;1;17;Primera División;2022/2023
28.01.23;Real Madrid;Athletic Club;2;1;17;Primera División;2022/2023
29.01.23;Atlético Madrid;Sevilla FC;1;1;17;Primera División;2022/2023
29.01.23;Real Sociedad;Sporting de Huelva;4;0;17;Primera División;2022/2023
29.01.23;Levante Las Planas;Valencia CF;0;3;17;Primera División;2022/2023
29.01.23;Costa Adeje Tenerife;FC Barcelona;0;6;17;Primera División;2022/2023
04.02.23;Alhama CF;Levante Las Planas;0;0;18;Primera División;2022/2023
04.02.23;Athletic Club;Costa Adeje Tenerife;0;1;18;Primera División;2022/2023
04.02.23;CD Alavés;Levante UD;0;2;18;Primera División;2022/2023
04.02.23;Valencia CF;Real Madrid;1;6;18;Primera División;2022/2023
05.02.23;Sevilla FC;Villarreal CF;1;0;18;Primera División;2022/2023
05.02.23;Sporting de Huelva;Atlético Madrid;1;3;18;Primera División;2022/2023
05.02.23;Madrid CFF;Real Sociedad;2;2;18;Primera División;2022/2023
05.02.23;FC Barcelona;Real Betis;7;0;18;Primera División;2022/2023
11.02.23;Levante UD;Levante Las Planas;5;0;19;Primera División;2022/2023
11.02.23;Real Betis;Valencia CF;0;1;19;Primera División;2022/2023
11.02.23;Villarreal CF;Madrid CFF;0;3;19;Primera División;2022/2023
11.02.23;CD Alavés;FC Barcelona;0;4;19;Primera División;2022/2023
12.02.23;Atlético Madrid;Athletic Club;1;0;19;Primera División;2022/2023
12.02.23;Costa Adeje Tenerife;Alhama CF;0;0;19;Primera División;2022/2023
12.02.23;Real Sociedad;Sevilla FC;0;3;19;Primera División;2022/2023
12.02.23;Real Madrid;Sporting de Huelva;1;0;19;Primera División;2022/2023
04.03.23;Sporting de Huelva;Athletic Club;2;3;20;Primera División;2022/2023
04.03.23;Real Sociedad;Atlético Madrid;1;2;20;Primera División;2022/2023
04.03.23;Madrid CFF;CD Alavés;5;1;20;Primera División;2022/2023
04.03.23;Valencia CF;Costa Adeje Tenerife;2;1;20;Primera División;2022/2023
04.03.23;Alhama CF;Real Madrid;1;5;20;Primera División;2022/2023
05.03.23;FC Barcelona;Villarreal CF;5;0;20;Primera División;2022/2023
05.03.23;Sevilla FC;Levante UD;2;4;20;Primera División;2022/2023
05.03.23;Levante Las Planas;Real Betis;2;2;20;Primera División;2022/2023
11.03.23;CD Alavés;Sporting de Huelva;2;1;21;Primera División;2022/2023
11.03.23;Levante Las Planas;Sevilla FC;1;1;21;Primera División;2022/2023
11.03.23;Real Betis;Real Sociedad;0;0;21;Primera División;2022/2023
11.03.23;Levante UD;FC Barcelona;0;4;21;Primera División;2022/2023
12.03.23;Athletic Club;Valencia CF;0;2;21;Primera División;2022/2023
12.03.23;Villarreal CF;Alhama CF;3;1;21;Primera División;2022/2023
12.03.23;Costa Adeje Tenerife;Madrid CFF;5;2;21;Primera División;2022/2023
12.03.23;Atlético Madrid;Real Madrid;0;0;21;Primera División;2022/2023
17.03.23;FC Barcelona;Valencia CF;5;1;22;Primera División;2022/2023
18.03.23;Madrid CFF;Athletic Club;3;2;22;Primera División;2022/2023
18.03.23;Real Madrid;Costa Adeje Tenerife;0;1;22;Primera División;2022/2023
18.03.23;Sevilla FC;Real Betis;3;0;22;Primera División;2022/2023
19.03.23;Villarreal CF;Levante Las Planas;0;0;22;Primera División;2022/2023
19.03.23;Real Sociedad;CD Alavés;6;5;22;Primera División;2022/2023
19.03.23;Sporting de Huelva;Levante UD;0;3;22;Primera División;2022/2023
19.03.23;Alhama CF;Atlético Madrid;1;3;22;Primera División;2022/2023
24.03.23;Athletic Club;Sevilla FC;1;1;23;Primera División;2022/2023
25.03.23;Costa Adeje Tenerife;Sporting de Huelva;2;0;23;Primera División;2022/2023
25.03.23;Real Betis;Villarreal CF;1;1;23;Primera División;2022/2023
25.03.23;FC Barcelona;Real Madrid;1;0;23;Primera División;2022/2023
26.03.23;CD Alavés;Atlético Madrid;1;2;23;Primera División;2022/2023
26.03.23;Levante Las Planas;Madrid CFF;2;2;23;Primera División;2022/2023
26.03.23;Valencia CF;Alhama CF;1;3;23;Primera División;2022/2023
26.03.23;Levante UD;Real Sociedad;4;1;23;Primera División;2022/2023
31.03.23;Real Madrid;Levante Las Planas;3;0;24;Primera División;2022/2023
01.04.23;Villarreal CF;Costa Adeje Tenerife;1;2;24;Primera División;2022/2023
01.04.23;Madrid CFF;Levante UD;1;0;24;Primera División;2022/2023
01.04.23;Sevilla FC;CD Alavés;4;2;24;Primera División;2022/2023
01.04.23;Atlético Madrid;Valencia CF;6;2;24;Primera División;2022/2023
02.04.23;Sporting de Huelva;Real Betis;0;1;24;Primera División;2022/2023
02.04.23;Real Sociedad;Athletic Club;1;1;24;Primera División;2022/2023
02.04.23;Alhama CF;FC Barcelona;0;2;24;Primera División;2022/2023
15.04.23;Alhama CF;Real Sociedad;1;1;25;Primera División;2022/2023
15.04.23;Athletic Club;CD Alavés;1;0;25;Primera División;2022/2023
15.04.23;FC Barcelona;Atlético Madrid;4;0;25;Primera División;2022/2023
15.04.23;Levante Las Planas;Costa Adeje Tenerife;2;3;25;Primera División;2022/2023
15.04.23;Levante UD;Villarreal CF;3;1;25;Primera División;2022/2023
16.04.23;Valencia CF;Sporting de Huelva;1;2;25;Primera División;2022/2023
16.04.23;Madrid CFF;Sevilla FC;0;0;25;Primera División;2022/2023
16.04.23;Real Betis;Real Madrid;1;3;25;Primera División;2022/2023
21.04.23;Athletic Club;Alhama CF;1;0;26;Primera División;2022/2023
22.04.23;Real Sociedad;Valencia CF;4;0;26;Primera División;2022/2023
22.04.23;Costa Adeje Tenerife;Real Betis;0;2;26;Primera División;2022/2023
22.04.23;CD Alavés;Levante Las Planas;1;0;26;Primera División;2022/2023
23.04.23;Atlético Madrid;Levante UD;2;1;26;Primera División;2022/2023
23.04.23;Sporting de Huelva;Madrid CFF;1;2;26;Primera División;2022/2023
23.04.23;Real Madrid;Villarreal CF;2;1;26;Primera División;2022/2023
10.05.23;Sevilla FC;FC Barcelona;1;1;26;Primera División;2022/2023
28.04.23;Alhama CF;Sevilla FC;0;0;27;Primera División;2022/2023
29.04.23;Costa Adeje Tenerife;Levante UD;0;1;27;Primera División;2022/2023
29.04.23;Valencia CF;CD Alavés;2;1;27;Primera División;2022/2023
29.04.23;Levante Las Planas;Athletic Club;0;1;27;Primera División;2022/2023
30.04.23;Real Betis;Atlético Madrid;1;1;27;Primera División;2022/2023
30.04.23;Villarreal CF;Real Sociedad;0;1;27;Primera División;2022/2023
30.04.23;FC Barcelona;Sporting de Huelva;3;0;27;Primera División;2022/2023
30.04.23;Real Madrid;Madrid CFF;3;2;27;Primera División;2022/2023
05.05.23;Sevilla FC;Real Madrid;0;2;28;Primera División;2022/2023
06.05.23;Atlético Madrid;Levante Las Planas;0;1;28;Primera División;2022/2023
06.05.23;CD Alavés;Costa Adeje Tenerife;1;1;28;Primera División;2022/2023
06.05.23;Madrid CFF;Alhama CF;6;2;28;Primera División;2022/2023
06.05.23;Real Sociedad;FC Barcelona;2;5;28;Primera División;2022/2023
07.05.23;Athletic Club;Real Betis;2;0;28;Primera División;2022/2023
07.05.23;Sporting de Huelva;Villarreal CF;1;1;28;Primera División;2022/2023
07.05.23;Levante UD;Valencia CF;1;1;28;Primera División;2022/2023
13.05.23;Alhama CF;Sporting de Huelva;0;0;29;Primera División;2022/2023
13.05.23;Real Betis;CD Alavés;1;1;29;Primera División;2022/2023
13.05.23;FC Barcelona;Athletic Club;3;0;29;Primera División;2022/2023
13.05.23;Villarreal CF;Atlético Madrid;1;1;29;Primera División;2022/2023
13.05.23;Levante Las Planas;Real Sociedad;1;0;29;Primera División;2022/2023
14.05.23;Real Madrid;Levante UD;3;2;29;Primera División;2022/2023
14.05.23;Costa Adeje Tenerife;Sevilla FC;3;1;29;Primera División;2022/2023
14.05.23;Valencia CF;Madrid CFF;0;2;29;Primera División;2022/2023
19.05.23;Real Sociedad;Real Madrid;1;1;30;Primera División;2022/2023
19.05.23;Sevilla FC;Valencia CF;2;0;30;Primera División;2022/2023
19.05.23;Atlético Madrid;Costa Adeje Tenerife;4;0;30;Primera División;2022/2023
20.05.23;Athletic Club;Villarreal CF;1;1;30;Primera División;2022/2023
20.05.23;CD Alavés;Alhama CF;1;1;30;Primera División;2022/2023
20.05.23;Sporting de Huelva;Levante Las Planas;2;0;30;Primera División;2022/2023
21.05.23;Madrid CFF;FC Barcelona;2;1;30;Primera División;2022/2023
21.05.23;Levante UD;Real Betis;4;0;30;Primera División;2022/2023
03.10.23;Villarreal CF;Atlético Madrid;1;3;1;Primera División;2023/2024
04.10.23;Athletic Club;Granada CF;1;0;1;Primera División;2023/2024
04.10.23;Sevilla FC;Costa Adeje Tenerife;5;1;1;Primera División;2023/2024
04.10.23;Real Sociedad;Levante UD;1;1;1;Primera División;2023/2024
04.10.23;Real Madrid;Real Betis;5;1;1;Primera División;2023/2024
04.10.23;SD Eibar;Madrid CFF;1;6;1;Primera División;2023/2024
05.10.23;Levante Las Planas;Sporting de Huelva;1;1;1;Primera División;2023/2024
05.10.23;FC Barcelona;Valencia CF;6;0;1;Primera División;2023/2024
15.09.23;Valencia CF;Real Madrid;0;2;2;Primera División;2023/2024
16.09.23;Atlético Madrid;Athletic Club;3;0;2;Primera División;2023/2024
16.09.23;SD Eibar;Levante Las Planas;1;2;2;Primera División;2023/2024
16.09.23;Real Betis;Villarreal CF;1;0;2;Primera División;2023/2024
16.09.23;Madrid CFF;FC Barcelona;0;2;2;Primera División;2023/2024
17.09.23;Costa Adeje Tenerife;Sporting de Huelva;2;0;2;Primera División;2023/2024
17.09.23;Granada CF;Real Sociedad;2;1;2;Primera División;2023/2024
17.09.23;Levante UD;Sevilla FC;2;0;2;Primera División;2023/2024
30.09.23;Sevilla FC;Madrid CFF;1;5;3;Primera División;2023/2024
30.09.23;Granada CF;SD Eibar;1;2;3;Primera División;2023/2024
30.09.23;Levante UD;Atlético Madrid;1;1;3;Primera División;2023/2024
30.09.23;Villarreal CF;Valencia CF;1;2;3;Primera División;2023/2024
01.10.23;Real Sociedad;Real Betis;2;1;3;Primera División;2023/2024
01.10.23;Costa Adeje Tenerife;Real Madrid;1;2;3;Primera División;2023/2024
01.10.23;Levante Las Planas;Athletic Club;2;1;3;Primera División;2023/2024
01.10.23;Sporting de Huelva;FC Barcelona;1;2;3;Primera División;2023/2024
07.10.23;Atlético Madrid;Sevilla FC;2;1;4;Primera División;2023/2024
07.10.23;Real Madrid;Villarreal CF;1;0;4;Primera División;2023/2024
08.10.23;SD Eibar;Costa Adeje Tenerife;0;1;4;Primera División;2023/2024
08.10.23;Real Betis;Levante UD;0;4;4;Primera División;2023/2024
08.10.23;Madrid CFF;Granada CF;1;0;4;Primera División;2023/2024
08.10.23;FC Barcelona;Real Sociedad;3;0;4;Primera División;2023/2024
09.10.23;Athletic Club;Sporting de Huelva;3;0;4;Primera División;2023/2024
09.10.23;Valencia CF;Levante Las Planas;1;1;4;Primera División;2023/2024
14.10.23;Villarreal CF;Athletic Club;3;0;5;Primera División;2023/2024
14.10.23;Granada CF;Real Madrid;2;5;5;Primera División;2023/2024
14.10.23;Real Sociedad;SD Eibar;3;1;5;Primera División;2023/2024
14.10.23;Sevilla FC;Valencia CF;1;2;5;Primera División;2023/2024
15.10.23;Sporting de Huelva;Madrid CFF;1;3;5;Primera División;2023/2024
15.10.23;Costa Adeje Tenerife;Real Betis;1;0;5;Primera División;2023/2024
15.10.23;Levante UD;Levante Las Planas;1;1;5;Primera División;2023/2024
15.10.23;Atlético Madrid;FC Barcelona;0;1;5;Primera División;2023/2024
21.10.23;Real Betis;Valencia CF;2;2;6;Primera División;2023/2024
21.10.23;SD Eibar;Villarreal CF;0;0;6;Primera División;2023/2024
21.10.23;Sporting de Huelva;Atlético Madrid;0;2;6;Primera División;2023/2024
21.10.23;FC Barcelona;Granada CF;6;1;6;Primera División;2023/2024
22.10.23;Athletic Club;Real Sociedad;2;1;6;Primera División;2023/2024
22.10.23;Madrid CFF;Costa Adeje Tenerife;3;2;6;Primera División;2023/2024
22.10.23;Levante Las Planas;Sevilla FC;1;2;6;Primera División;2023/2024
22.10.23;Real Madrid;Levante UD;1;2;6;Primera División;2023/2024
04.11.23;Real Sociedad;Villarreal CF;1;0;7;Primera División;2023/2024
04.11.23;Real Betis;Athletic Club;1;0;7;Primera División;2023/2024
04.11.23;Valencia CF;Sporting de Huelva;2;0;7;Primera División;2023/2024
04.11.23;SD Eibar;Real Madrid;0;1;7;Primera División;2023/2024
05.11.23;Costa Adeje Tenerife;Atlético Madrid;2;1;7;Primera División;2023/2024
05.11.23;Granada CF;Levante Las Planas;0;1;7;Primera División;2023/2024
05.11.23;FC Barcelona;Sevilla FC;8;0;7;Primera División;2023/2024
05.11.23;Madrid CFF;Levante UD;0;1;7;Primera División;2023/2024
10.11.23;Real Madrid;Real Sociedad;7;1;8;Primera División;2023/2024
11.11.23;Atlético Madrid;SD Eibar;3;0;8;Primera División;2023/2024
11.11.23;Villarreal CF;FC Barcelona;0;6;8;Primera División;2023/2024
11.11.23;Sporting de Huelva;Real Betis;1;3;8;Primera División;2023/2024
12.11.23;Sevilla FC;Granada CF;1;0;8;Primera División;2023/2024
12.11.23;Levante Las Planas;Costa Adeje Tenerife;3;1;8;Primera División;2023/2024
12.11.23;Levante UD;Valencia CF;3;1;8;Primera División;2023/2024
12.11.23;Athletic Club;Madrid CFF;1;2;8;Primera División;2023/2024
18.11.23;Costa Adeje Tenerife;Levante UD;0;1;9;Primera División;2023/2024
18.11.23;Real Sociedad;Sevilla FC;1;2;9;Primera División;2023/2024
18.11.23;SD Eibar;Sporting de Huelva;1;0;9;Primera División;2023/2024
18.11.23;Valencia CF;Athletic Club;1;2;9;Primera División;2023/2024
19.11.23;FC Barcelona;Real Madrid;5;0;9;Primera División;2023/2024
19.11.23;Granada CF;Villarreal CF;1;2;9;Primera División;2023/2024
19.11.23;Madrid CFF;Atlético Madrid;1;4;9;Primera División;2023/2024
19.11.23;Real Betis;Levante Las Planas;1;0;9;Primera División;2023/2024
25.11.23;Villarreal CF;Costa Adeje Tenerife;1;1;10;Primera División;2023/2024
25.11.23;Real Sociedad;Valencia CF;2;0;10;Primera División;2023/2024
25.11.23;Levante UD;SD Eibar;3;0;10;Primera División;2023/2024
25.11.23;Sevilla FC;Real Betis;6;0;10;Primera División;2023/2024
26.11.23;Atlético Madrid;Granada CF;2;0;10;Primera División;2023/2024
26.11.23;Real Madrid;Sporting de Huelva;5;2;10;Primera División;2023/2024
26.11.23;Levante Las Planas;Madrid CFF;3;4;10;Primera División;2023/2024
26.11.23;Athletic Club;FC Barcelona;0;4;10;Primera División;2023/2024
09.12.23;Costa Adeje Tenerife;Granada CF;2;0;11;Primera División;2023/2024
09.12.23;Sporting de Huelva;Real Sociedad;1;2;11;Primera División;2023/2024
09.12.23;FC Barcelona;SD Eibar;5;0;11;Primera División;2023/2024
09.12.23;Real Madrid;Sevilla FC;1;3;11;Primera División;2023/2024
10.12.23;Athletic Club;Levante UD;1;0;11;Primera División;2023/2024
10.12.23;Villarreal CF;Levante Las Planas;2;2;11;Primera División;2023/2024
10.12.23;Real Betis;Atlético Madrid;0;2;11;Primera División;2023/2024
10.12.23;Valencia CF;Madrid CFF;3;4;11;Primera División;2023/2024
16.12.23;Atlético Madrid;Real Sociedad;1;1;12;Primera División;2023/2024
16.12.23;Madrid CFF;Villarreal CF;2;0;12;Primera División;2023/2024
16.12.23;Levante UD;Sporting de Huelva;2;0;12;Primera División;2023/2024
16.12.23;SD Eibar;Real Betis;3;2;12;Primera División;2023/2024
17.12.23;Costa Adeje Tenerife;FC Barcelona;0;2;12;Primera División;2023/2024
17.12.23;Levante Las Planas;Real Madrid;0;2;12;Primera División;2023/2024
17.12.23;Granada CF;Valencia CF;0;1;12;Primera División;2023/2024
17.12.23;Sevilla FC;Athletic Club;1;1;12;Primera División;2023/2024
06.01.24;FC Barcelona;Levante Las Planas;9;1;13;Primera División;2023/2024
06.01.24;Villarreal CF;Levante UD;0;5;13;Primera División;2023/2024
07.01.24;Athletic Club;SD Eibar;2;0;13;Primera División;2023/2024
07.01.24;Real Sociedad;Costa Adeje Tenerife;3;3;13;Primera División;2023/2024
07.01.24;Real Betis;Granada CF;2;3;13;Primera División;2023/2024
07.01.24;Valencia CF;Atlético Madrid;1;6;13;Primera División;2023/2024
07.01.24;Real Madrid;Madrid CFF;2;1;13;Primera División;2023/2024
07.01.24;Sporting de Huelva;Sevilla FC;1;3;13;Primera División;2023/2024
20.01.24;Sevilla FC;Villarreal CF;3;1;14;Primera División;2023/2024
20.01.24;Levante Las Planas;Real Sociedad;0;2;14;Primera División;2023/2024
20.01.24;Madrid CFF;Real Betis;3;1;14;Primera División;2023/2024
21.01.24;Costa Adeje Tenerife;Athletic Club;1;1;14;Primera División;2023/2024
21.01.24;Granada CF;Sporting de Huelva;0;1;14;Primera División;2023/2024
21.01.24;SD Eibar;Valencia CF;1;0;14;Primera División;2023/2024
14.02.24;FC Barcelona;Levante UD;1;1;14;Primera División;2023/2024
14.02.24;Atlético Madrid;Real Madrid;1;1;14;Primera División;2023/2024
27.01.24;Valencia CF;Costa Adeje Tenerife;1;1;15;Primera División;2023/2024
27.01.24;Levante Las Planas;Atlético Madrid;1;1;15;Primera División;2023/2024
27.01.24;Sporting de Huelva;Villarreal CF;0;1;15;Primera División;2023/2024
27.01.24;Athletic Club;Real Madrid;0;1;15;Primera División;2023/2024
28.01.24;Levante UD;Granada CF;2;2;15;Primera División;2023/2024
28.01.24;Real Betis;FC Barcelona;0;6;15;Primera División;2023/2024
28.01.24;Real Sociedad;Madrid CFF;1;1;15;Primera División;2023/2024
28.01.24;Sevilla FC;SD Eibar;3;0;15;Primera División;2023/2024
03.02.24;Granada CF;Athletic Club;2;0;16;Primera División;2023/2024
03.02.24;Madrid CFF;Sevilla FC;3;3;16;Primera División;2023/2024
03.02.24;Atlético Madrid;Levante UD;0;1;16;Primera División;2023/2024
03.02.24;Villarreal CF;Real Betis;2;1;16;Primera División;2023/2024
03.02.24;Real Madrid;Valencia CF;7;1;16;Primera División;2023/2024
04.02.24;SD Eibar;Real Sociedad;0;2;16;Primera División;2023/2024
04.02.24;Costa Adeje Tenerife;Levante Las Planas;1;1;16;Primera División;2023/2024
04.02.24;FC Barcelona;Sporting de Huelva;4;0;16;Primera División;2023/2024
10.02.24;Levante Las Planas;SD Eibar;1;1;17;Primera División;2023/2024
10.02.24;Valencia CF;Villarreal CF;0;1;17;Primera División;2023/2024
10.02.24;Sevilla FC;FC Barcelona;0;3;17;Primera División;2023/2024
11.02.24;Real Sociedad;Granada CF;1;1;17;Primera División;2023/2024
11.02.24;Levante UD;Costa Adeje Tenerife;1;0;17;Primera División;2023/2024
11.02.24;Real Betis;Real Madrid;1;4;17;Primera División;2023/2024
11.02.24;Atlético Madrid;Madrid CFF;1;1;17;Primera División;2023/2024
11.02.24;Sporting de Huelva;Athletic Club;1;2;17;Primera División;2023/2024
17.02.24;Sporting de Huelva;Valencia CF;1;3;18;Primera División;2023/2024
17.02.24;Granada CF;Sevilla FC;2;2;18;Primera División;2023/2024
17.02.24;Athletic Club;Real Betis;1;0;18;Primera División;2023/2024
17.02.24;Villarreal CF;Real Sociedad;1;1;18;Primera División;2023/2024
18.02.24;SD Eibar;Levante UD;0;0;18;Primera División;2023/2024
18.02.24;FC Barcelona;Atlético Madrid;2;0;18;Primera División;2023/2024
18.02.24;Real Madrid;Costa Adeje Tenerife;2;1;18;Primera División;2023/2024
18.02.24;Madrid CFF;Levante Las Planas;2;1;18;Primera División;2023/2024
09.03.24;Costa Adeje Tenerife;Villarreal CF;1;1;19;Primera División;2023/2024
09.03.24;Levante Las Planas;Granada CF;1;2;19;Primera División;2023/2024
09.03.24;Madrid CFF;SD Eibar;1;2;19;Primera División;2023/2024
09.03.24;Sevilla FC;Real Madrid;0;1;19;Primera División;2023/2024
10.03.24;Levante UD;Athletic Club;1;2;19;Primera División;2023/2024
10.03.24;Real Sociedad;FC Barcelona;1;7;19;Primera División;2023/2024
10.03.24;Valencia CF;Real Betis;2;2;19;Primera División;2023/2024
10.03.24;Atlético Madrid;Sporting de Huelva;1;0;19;Primera División;2023/2024
16.03.24;Villarreal CF;Madrid CFF;1;4;20;Primera División;2023/2024
16.03.24;Sporting de Huelva;Levante UD;1;1;20;Primera División;2023/2024
16.03.24;Sevilla FC;Levante Las Planas;3;0;20;Primera División;2023/2024
16.03.24;Real Madrid;SD Eibar;1;0;20;Primera División;2023/2024
17.03.24;Granada CF;Atlético Madrid;0;1;20;Primera División;2023/2024
17.03.24;FC Barcelona;Costa Adeje Tenerife;7;0;20;Primera División;2023/2024
17.03.24;Real Betis;Real Sociedad;0;0;20;Primera División;2023/2024
17.03.24;Athletic Club;Valencia CF;2;0;20;Primera División;2023/2024
23.03.24;Costa Adeje Tenerife;Sevilla FC;5;0;21;Primera División;2023/2024
23.03.24;Levante UD;Real Betis;7;0;21;Primera División;2023/2024
23.03.24;Real Sociedad;Athletic Club;0;1;21;Primera División;2023/2024
23.03.24;Valencia CF;Granada CF;4;1;21;Primera División;2023/2024
24.03.24;SD Eibar;Atlético Madrid;1;1;21;Primera División;2023/2024
24.03.24;Levante Las Planas;Villarreal CF;1;1;21;Primera División;2023/2024
24.03.24;Madrid CFF;Sporting de Huelva;2;1;21;Primera División;2023/2024
24.03.24;Real Madrid;FC Barcelona;0;3;21;Primera División;2023/2024
30.03.24;Sevilla FC;Real Sociedad;4;2;22;Primera División;2023/2024
30.03.24;Real Betis;SD Eibar;0;0;22;Primera División;2023/2024
30.03.24;Atlético Madrid;Valencia CF;1;0;22;Primera División;2023/2024
30.03.24;Villarreal CF;Real Madrid;0;2;22;Primera División;2023/2024
31.03.24;Sporting de Huelva;Costa Adeje Tenerife;1;2;22;Primera División;2023/2024
31.03.24;Granada CF;Madrid CFF;3;0;22;Primera División;2023/2024
31.03.24;Athletic Club;Levante Las Planas;4;1;22;Primera División;2023/2024
31.03.24;Levante UD;FC Barcelona;0;5;22;Primera División;2023/2024
13.04.24;Real Sociedad;Sporting de Huelva;1;1;23;Primera División;2023/2024
13.04.24;SD Eibar;Sevilla FC;3;0;23;Primera División;2023/2024
13.04.24;Levante Las Planas;Real Betis;1;2;23;Primera División;2023/2024
13.04.24;FC Barcelona;Villarreal CF;5;1;23;Primera División;2023/2024
14.04.24;Athletic Club;Atlético Madrid;1;0;23;Primera División;2023/2024
14.04.24;Costa Adeje Tenerife;Madrid CFF;2;2;23;Primera División;2023/2024
14.04.24;Valencia CF;Levante UD;1;1;23;Primera División;2023/2024
14.04.24;Real Madrid;Granada CF;5;0;23;Primera División;2023/2024
20.04.24;Levante UD;Real Madrid;2;4;24;Primera División;2023/2024
20.04.24;Granada CF;Costa Adeje Tenerife;2;1;24;Primera División;2023/2024
20.04.24;Sporting de Huelva;SD Eibar;0;1;24;Primera División;2023/2024
20.04.24;Madrid CFF;Athletic Club;2;1;24;Primera División;2023/2024
21.04.24;Atlético Madrid;Real Betis;5;1;24;Primera División;2023/2024
21.04.24;Villarreal CF;Sevilla FC;1;2;24;Primera División;2023/2024
21.04.24;Valencia CF;Real Sociedad;3;0;24;Primera División;2023/2024
24.04.24;Levante Las Planas;FC Barcelona;2;4;24;Primera División;2023/2024
27.04.24;Villarreal CF;Granada CF;1;2;25;Primera División;2023/2024
27.04.24;Costa Adeje Tenerife;Valencia CF;1;0;25;Primera División;2023/2024
27.04.24;Real Betis;Sporting de Huelva;3;1;25;Primera División;2023/2024
27.04.24;Sevilla FC;Levante UD;1;3;25;Primera División;2023/2024
28.04.24;SD Eibar;Athletic Club;0;2;25;Primera División;2023/2024
28.04.24;Real Sociedad;Atlético Madrid;0;2;25;Primera División;2023/2024
28.04.24;Real Madrid;Levante Las Planas;2;1;25;Primera División;2023/2024
01.05.24;FC Barcelona;Madrid CFF;8;0;25;Primera División;2023/2024
04.05.24;Atlético Madrid;Costa Adeje Tenerife;1;0;26;Primera División;2023/2024
04.05.24;Valencia CF;SD Eibar;0;2;26;Primera División;2023/2024
04.05.24;Athletic Club;Villarreal CF;1;0;26;Primera División;2023/2024
04.05.24;Granada CF;FC Barcelona;1;4;26;Primera División;2023/2024
05.05.24;Levante UD;Real Sociedad;4;3;26;Primera División;2023/2024
05.05.24;Sporting de Huelva;Levante Las Planas;1;2;26;Primera División;2023/2024
05.05.24;Real Betis;Sevilla FC;1;1;26;Primera División;2023/2024
05.05.24;Madrid CFF;Real Madrid;0;1;26;Primera División;2023/2024
10.05.24;Villarreal CF;SD Eibar;1;1;27;Primera División;2023/2024
10.05.24;FC Barcelona;Athletic Club;7;0;27;Primera División;2023/2024
11.05.24;Granada CF;Real Betis;2;3;27;Primera División;2023/2024
11.05.24;Levante Las Planas;Levante UD;1;1;27;Primera División;2023/2024
11.05.24;Real Madrid;Atlético Madrid;2;3;27;Primera División;2023/2024
12.05.24;Costa Adeje Tenerife;Real Sociedad;0;1;27;Primera División;2023/2024
12.05.24;Sevilla FC;Sporting de Huelva;2;0;27;Primera División;2023/2024
12.05.24;Madrid CFF;Valencia CF;6;1;27;Primera División;2023/2024
14.05.24;SD Eibar;FC Barcelona;0;4;28;Primera División;2023/2024
24.05.24;Athletic Club;Costa Adeje Tenerife;4;1;28;Primera División;2023/2024
24.05.24;Atlético Madrid;Levante Las Planas;3;1;28;Primera División;2023/2024
25.05.24;Sporting de Huelva;Granada CF;2;1;28;Primera División;2023/2024
25.05.24;Levante UD;Villarreal CF;2;1;28;Primera División;2023/2024
26.05.24;Valencia CF;Sevilla FC;3;1;28;Primera División;2023/2024
26.05.24;Real Sociedad;Real Madrid;1;2;28;Primera División;2023/2024
26.05.24;Real Betis;Madrid CFF;0;0;28;Primera División;2023/2024
09.06.24;Madrid CFF;Real Sociedad;2;3;29;Primera División;2023/2024
09.06.24;Costa Adeje Tenerife;SD Eibar;1;1;29;Primera División;2023/2024
09.06.24;Real Madrid;Athletic Club;1;0;29;Primera División;2023/2024
09.06.24;FC Barcelona;Real Betis;5;1;29;Primera División;2023/2024
09.06.24;Granada CF;Levante UD;0;3;29;Primera División;2023/2024
09.06.24;Sevilla FC;Atlético Madrid;1;1;29;Primera División;2023/2024
09.06.24;Villarreal CF;Sporting de Huelva;2;0;29;Primera División;2023/2024
09.06.24;Levante Las Planas;Valencia CF;3;0;29;Primera División;2023/2024
14.06.24;Sporting de Huelva;Real Madrid;1;4;30;Primera División;2023/2024
15.06.24;Atlético Madrid;Villarreal CF;1;0;30;Primera División;2023/2024
15.06.24;Real Betis;Costa Adeje Tenerife;1;0;30;Primera División;2023/2024
15.06.24;Real Sociedad;Levante Las Planas;2;2;30;Primera División;2023/2024
15.06.24;SD Eibar;Granada CF;0;2;30;Primera División;2023/2024
15.06.24;Levante UD;Madrid CFF;3;0;30;Primera División;2023/2024
16.06.24;Valencia CF;FC Barcelona;0;3;30;Primera División;2023/2024
16.06.24;Athletic Club;Sevilla FC;2;1;30;Primera División;2023/2024
06.09.24;Espanyol Barcelona;Real Madrid;0;5;1;Primera División;2024/2025
07.09.24;Madrid CFF;Costa Adeje Tenerife;2;1;1;Primera División;2024/2025
07.09.24;SD Eibar;Real Betis;2;0;1;Primera División;2024/2025
07.09.24;Sevilla FC;Real Sociedad;3;2;1;Primera División;2024/2025
08.09.24;Levante UD;Athletic Club;0;1;1;Primera División;2024/2025
08.09.24;Deportivo La Coruña;FC Barcelona;0;3;1;Primera División;2024/2025
08.09.24;Valencia CF;FC Badalona Women;1;1;1;Primera División;2024/2025
11.09.24;Atlético Madrid;Granada CF;2;0;1;Primera División;2024/2025
13.09.24;FC Barcelona;Real Sociedad;3;1;2;Primera División;2024/2025
14.09.24;Costa Adeje Tenerife;Sevilla FC;4;1;2;Primera División;2024/2025
14.09.24;Real Betis;Real Madrid;0;3;2;Primera División;2024/2025
14.09.24;FC Badalona Women;Levante UD;2;0;2;Primera División;2024/2025
15.09.24;Athletic Club;Granada CF;2;1;2;Primera División;2024/2025
15.09.24;Madrid CFF;Espanyol Barcelona;2;1;2;Primera División;2024/2025
15.09.24;Atlético Madrid;Deportivo La Coruña;2;1;2;Primera División;2024/2025
15.09.24;SD Eibar;Valencia CF;2;0;2;Primera División;2024/2025
21.09.24;Levante UD;Real Sociedad;1;2;3;Primera División;2024/2025
21.09.24;Granada CF;SD Eibar;2;0;3;Primera División;2024/2025
21.09.24;FC Badalona Women;Madrid CFF;1;0;3;Primera División;2024/2025
21.09.24;Sevilla FC;FC Barcelona;0;1;3;Primera División;2024/2025
22.09.24;Espanyol Barcelona;Costa Adeje Tenerife;0;0;3;Primera División;2024/2025
22.09.24;Valencia CF;Atlético Madrid;0;4;3;Primera División;2024/2025
22.09.24;Deportivo La Coruña;Real Betis;0;0;3;Primera División;2024/2025
22.09.24;Real Madrid;Athletic Club;2;0;3;Primera División;2024/2025
27.09.24;Atlético Madrid;Madrid CFF;4;0;4;Primera División;2024/2025
28.09.24;SD Eibar;Levante UD;0;3;4;Primera División;2024/2025
28.09.24;Real Betis;Espanyol Barcelona;0;0;4;Primera División;2024/2025
28.09.24;FC Barcelona;Granada CF;10;1;4;Primera División;2024/2025
28.09.24;Deportivo La Coruña;Athletic Club;2;2;4;Primera División;2024/2025
29.09.24;Valencia CF;Sevilla FC;1;3;4;Primera División;2024/2025
29.09.24;Real Sociedad;FC Badalona Women;2;1;4;Primera División;2024/2025
29.09.24;Costa Adeje Tenerife;Real Madrid;1;4;4;Primera División;2024/2025
04.10.24;Real Madrid;Valencia CF;1;0;5;Primera División;2024/2025
05.10.24;Athletic Club;Atlético Madrid;0;2;5;Primera División;2024/2025
05.10.24;Madrid CFF;FC Barcelona;1;8;5;Primera División;2024/2025
05.10.24;Levante UD;Sevilla FC;0;0;5;Primera División;2024/2025
06.10.24;Granada CF;Real Sociedad;0;2;5;Primera División;2024/2025
06.10.24;Real Betis;Costa Adeje Tenerife;0;1;5;Primera División;2024/2025
06.10.24;Espanyol Barcelona;SD Eibar;2;1;5;Primera División;2024/2025
06.10.24;FC Badalona Women;Deportivo La Coruña;1;0;5;Primera División;2024/2025
12.10.24;Real Sociedad;Real Betis;4;0;6;Primera División;2024/2025
12.10.24;Costa Adeje Tenerife;Levante UD;0;0;6;Primera División;2024/2025
12.10.24;Deportivo La Coruña;Madrid CFF;1;0;6;Primera División;2024/2025
13.10.24;SD Eibar;Athletic Club;1;2;6;Primera División;2024/2025
13.10.24;Valencia CF;Granada CF;0;2;6;Primera División;2024/2025
13.10.24;Sevilla FC;FC Badalona Women;0;1;6;Primera División;2024/2025
13.10.24;FC Barcelona;Espanyol Barcelona;7;1;6;Primera División;2024/2025
13.10.24;Real Madrid;Atlético Madrid;1;1;6;Primera División;2024/2025
19.10.24;FC Badalona Women;Costa Adeje Tenerife;0;0;7;Primera División;2024/2025
19.10.24;Granada CF;Real Betis;1;2;7;Primera División;2024/2025
19.10.24;Atlético Madrid;Real Sociedad;1;0;7;Primera División;2024/2025
19.10.24;Sevilla FC;Espanyol Barcelona;1;0;7;Primera División;2024/2025
20.10.24;Athletic Club;Valencia CF;1;1;7;Primera División;2024/2025
20.10.24;SD Eibar;Deportivo La Coruña;0;0;7;Primera División;2024/2025
20.10.24;Levante UD;FC Barcelona;1;4;7;Primera División;2024/2025
20.10.24;Madrid CFF;Real Madrid;0;1;7;Primera División;2024/2025
02.11.24;Costa Adeje Tenerife;Athletic Club;2;1;8;Primera División;2024/2025
02.11.24;Real Betis;FC Badalona Women;4;3;8;Primera División;2024/2025
02.11.24;Espanyol Barcelona;Atlético Madrid;0;0;8;Primera División;2024/2025
02.11.24;FC Barcelona;SD Eibar;4;0;8;Primera División;2024/2025
03.11.24;Granada CF;Sevilla FC;3;0;8;Primera División;2024/2025
03.11.24;Real Sociedad;Madrid CFF;2;2;8;Primera División;2024/2025
08.12.24;Valencia CF;Deportivo La Coruña;0;2;8;Primera División;2024/2025
08.01.25;Real Madrid;Levante UD;6;0;8;Primera División;2024/2025
09.11.24;Madrid CFF;Sevilla FC;2;1;9;Primera División;2024/2025
09.11.24;FC Badalona Women;Real Madrid;1;3;9;Primera División;2024/2025
09.11.24;Atlético Madrid;FC Barcelona;0;3;9;Primera División;2024/2025
10.11.24;SD Eibar;Costa Adeje Tenerife;0;0;9;Primera División;2024/2025
10.11.24;Deportivo La Coruña;Real Sociedad;0;1;9;Primera División;2024/2025
10.11.24;Athletic Club;Real Betis;3;0;9;Primera División;2024/2025
10.11.24;Espanyol Barcelona;Granada CF;1;0;9;Primera División;2024/2025
05.01.25;Levante UD;Valencia CF;0;1;9;Primera División;2024/2025
16.11.24;Granada CF;FC Badalona Women;1;1;10;Primera División;2024/2025
16.11.24;Costa Adeje Tenerife;Valencia CF;2;0;10;Primera División;2024/2025
16.11.24;Madrid CFF;SD Eibar;2;1;10;Primera División;2024/2025
16.11.24;Real Madrid;FC Barcelona;0;4;10;Primera División;2024/2025
17.11.24;Deportivo La Coruña;Espanyol Barcelona;0;1;10;Primera División;2024/2025
17.11.24;Real Betis;Levante UD;1;2;10;Primera División;2024/2025
17.11.24;Sevilla FC;Atlético Madrid;1;2;10;Primera División;2024/2025
17.11.24;Real Sociedad;Athletic Club;1;0;10;Primera División;2024/2025
23.11.24;Sevilla FC;Deportivo La Coruña;2;1;11;Primera División;2024/2025
23.11.24;FC Badalona Women;Espanyol Barcelona;1;1;11;Primera División;2024/2025
23.11.24;Athletic Club;Madrid CFF;1;0;11;Primera División;2024/2025
24.11.24;FC Barcelona;Costa Adeje Tenerife;5;1;11;Primera División;2024/2025
24.11.24;Levante UD;Granada CF;2;3;11;Primera División;2024/2025
24.11.24;Atlético Madrid;SD Eibar;1;1;11;Primera División;2024/2025
24.11.24;Valencia CF;Real Betis;0;2;11;Primera División;2024/2025
04.02.25;Real Sociedad;Real Madrid;1;4;11;Primera División;2024/2025
07.12.24;Granada CF;Deportivo La Coruña;5;0;12;Primera División;2024/2025
07.12.24;Athletic Club;FC Badalona Women;1;0;12;Primera División;2024/2025
07.12.24;Real Madrid;Sevilla FC;4;1;12;Primera División;2024/2025
07.12.24;FC Barcelona;Real Betis;4;1;12;Primera División;2024/2025
08.12.24;SD Eibar;Real Sociedad;1;1;12;Primera División;2024/2025
08.12.24;Costa Adeje Tenerife;Atlético Madrid;2;2;12;Primera División;2024/2025
08.12.24;Madrid CFF;Levante UD;2;1;12;Primera División;2024/2025
08.12.24;Espanyol Barcelona;Valencia CF;1;0;12;Primera División;2024/2025
14.12.24;Granada CF;Madrid CFF;1;0;13;Primera División;2024/2025
14.12.24;Real Betis;Atlético Madrid;2;1;13;Primera División;2024/2025
14.12.24;Deportivo La Coruña;Real Madrid;1;4;13;Primera División;2024/2025
14.12.24;Real Sociedad;Costa Adeje Tenerife;2;0;13;Primera División;2024/2025
15.12.24;Valencia CF;FC Barcelona;0;1;13;Primera División;2024/2025
15.12.24;FC Badalona Women;SD Eibar;0;1;13;Primera División;2024/2025
15.12.24;Levante UD;Espanyol Barcelona;1;1;13;Primera División;2024/2025
15.12.24;Sevilla FC;Athletic Club;2;5;13;Primera División;2024/2025
11.01.25;Espanyol Barcelona;Athletic Club;1;2;14;Primera División;2024/2025
11.01.25;Costa Adeje Tenerife;Deportivo La Coruña;5;1;14;Primera División;2024/2025
11.01.25;SD Eibar;Sevilla FC;0;3;14;Primera División;2024/2025
11.01.25;FC Barcelona;FC Badalona Women;6;0;14;Primera División;2024/2025
12.01.25;Atlético Madrid;Levante UD;3;0;14;Primera División;2024/2025
12.01.25;Valencia CF;Real Sociedad;0;2;14;Primera División;2024/2025
12.01.25;Real Betis;Madrid CFF;1;1;14;Primera División;2024/2025
12.01.25;Real Madrid;Granada CF;3;1;14;Primera División;2024/2025
17.01.25;Deportivo La Coruña;Levante UD;1;0;15;Primera División;2024/2025
18.01.25;Granada CF;Costa Adeje Tenerife;2;1;15;Primera División;2024/2025
18.01.25;FC Badalona Women;Atlético Madrid;1;1;15;Primera División;2024/2025
18.01.25;Athletic Club;FC Barcelona;0;2;15;Primera División;2024/2025
18.01.25;Madrid CFF;Valencia CF;1;1;15;Primera División;2024/2025
19.01.25;Real Madrid;SD Eibar;0;1;15;Primera División;2024/2025
19.01.25;Real Sociedad;Espanyol Barcelona;4;1;15;Primera División;2024/2025
19.01.25;Sevilla FC;Real Betis;2;0;15;Primera División;2024/2025
05.01.25;Atlético Madrid;Real Madrid;1;2;16;Primera División;2024/2025
05.01.25;Real Sociedad;FC Barcelona;0;6;16;Primera División;2024/2025
25.01.25;Levante UD;FC Badalona Women;1;1;16;Primera División;2024/2025
25.01.25;Costa Adeje Tenerife;Madrid CFF;2;0;16;Primera División;2024/2025
25.01.25;Valencia CF;Athletic Club;0;1;16;Primera División;2024/2025
25.01.25;SD Eibar;Granada CF;0;0;16;Primera División;2024/2025
26.01.25;Real Betis;Deportivo La Coruña;0;2;16;Primera División;2024/2025
26.01.25;Espanyol Barcelona;Sevilla FC;0;0;16;Primera División;2024/2025
31.01.25;Real Madrid;Espanyol Barcelona;5;0;17;Primera División;2024/2025
01.02.25;Madrid CFF;Real Betis;0;2;17;Primera División;2024/2025
01.02.25;Deportivo La Coruña;Valencia CF;1;1;17;Primera División;2024/2025
01.02.25;FC Barcelona;Levante UD;1;2;17;Primera División;2024/2025
02.02.25;Athletic Club;SD Eibar;0;1;17;Primera División;2024/2025
02.02.25;Sevilla FC;Costa Adeje Tenerife;0;2;17;Primera División;2024/2025
02.02.25;FC Badalona Women;Real Betis;2;1;17;Primera División;2024/2025
02.02.25;Granada CF;Atlético Madrid;0;0;17;Primera División;2024/2025
07.02.25;Atlético Madrid;Sevilla FC;1;0;18;Primera División;2024/2025
08.02.25;SD Eibar;Madrid CFF;1;2;18;Primera División;2024/2025
08.02.25;FC Badalona Women;Granada CF;0;2;18;Primera División;2024/2025
08.02.25;Levante UD;Real Madrid;1;2;18;Primera División;2024/2025
08.02.25;Real Sociedad;Deportivo La Coruña;1;2;18;Primera División;2024/2025
09.02.25;Espanyol Barcelona;FC Barcelona;0;2;18;Primera División;2024/2025
09.02.25;Valencia CF;Costa Adeje Tenerife;1;2;18;Primera División;2024/2025
09.02.25;Real Betis;Athletic Club;0;4;18;Primera División;2024/2025
15.02.25;Sevilla FC;Valencia CF;3;1;19;Primera División;2024/2025
15.02.25;Costa Adeje Tenerife;SD Eibar;1;1;19;Primera División;2024/2025
16.02.25;Athletic Club;Real Sociedad;2;0;19;Primera División;2024/2025
16.02.25;Deportivo La Coruña;Atlético Madrid;0;0;19;Primera División;2024/2025
16.02.25;Granada CF;Espanyol Barcelona;2;1;19;Primera División;2024/2025
16.02.25;FC Barcelona;Madrid CFF;5;1;19;Primera División;2024/2025
16.02.25;Real Madrid;FC Badalona Women;3;2;19;Primera División;2024/2025
16.02.25;Levante UD;Real Betis;1;2;19;Primera División;2024/2025
01.03.25;Real Betis;Granada CF;1;3;20;Primera División;2024/2025
01.03.25;Valencia CF;Levante UD;1;1;20;Primera División;2024/2025
02.03.25;Athletic Club;Real Madrid;1;2;20;Primera División;2024/2025
02.03.25;Espanyol Barcelona;Deportivo La Coruña;1;1;20;Primera División;2024/2025
02.03.25;Costa Adeje Tenerife;FC Badalona Women;1;1;20;Primera División;2024/2025
02.03.25;SD Eibar;FC Barcelona;1;8;20;Primera División;2024/2025
02.03.25;Real Sociedad;Sevilla FC;0;0;20;Primera División;2024/2025
02.03.25;Madrid CFF;Atlético Madrid;0;3;20;Primera División;2024/2025
08.03.25;Levante UD;Costa Adeje Tenerife;2;0;21;Primera División;2024/2025
08.03.25;FC Badalona Women;Real Sociedad;0;0;21;Primera División;2024/2025
08.03.25;Espanyol Barcelona;Madrid CFF;3;3;21;Primera División;2024/2025
09.03.25;FC Barcelona;Valencia CF;4;1;21;Primera División;2024/2025
09.03.25;Granada CF;Athletic Club;0;2;21;Primera División;2024/2025
09.03.25;Sevilla FC;Real Madrid;0;4;21;Primera División;2024/2025
09.03.25;Atlético Madrid;Real Betis;0;0;21;Primera División;2024/2025
09.03.25;Deportivo La Coruña;SD Eibar;0;1;21;Primera División;2024/2025
15.03.25;Real Madrid;Deportivo La Coruña;2;2;22;Primera División;2024/2025
15.03.25;Real Betis;Valencia CF;0;1;22;Primera División;2024/2025
15.03.25;Athletic Club;Sevilla FC;0;1;22;Primera División;2024/2025
15.03.25;Costa Adeje Tenerife;FC Barcelona;0;2;22;Primera División;2024/2025
16.03.25;Atlético Madrid;Espanyol Barcelona;1;1;22;Primera División;2024/2025
16.03.25;Real Sociedad;Levante UD;1;2;22;Primera División;2024/2025
16.03.25;Madrid CFF;Granada CF;3;1;22;Primera División;2024/2025
16.03.25;SD Eibar;FC Badalona Women;1;0;22;Primera División;2024/2025
22.03.25;Real Betis;SD Eibar;0;1;23;Primera División;2024/2025
22.03.25;Deportivo La Coruña;Costa Adeje Tenerife;0;0;23;Primera División;2024/2025
22.03.25;FC Badalona Women;Athletic Club;0;1;23;Primera División;2024/2025
22.03.25;Espanyol Barcelona;Levante UD;1;0;23;Primera División;2024/2025
23.03.25;FC Barcelona;Real Madrid;1;3;23;Primera División;2024/2025
23.03.25;Real Sociedad;Atlético Madrid;0;2;23;Primera División;2024/2025
23.03.25;Sevilla FC;Granada CF;0;2;23;Primera División;2024/2025
23.03.25;Valencia CF;Madrid CFF;4;1;23;Primera División;2024/2025
29.03.25;Levante UD;SD Eibar;1;2;24;Primera División;2024/2025
29.03.25;Costa Adeje Tenerife;Espanyol Barcelona;4;1;24;Primera División;2024/2025
29.03.25;Madrid CFF;Real Betis;2;0;24;Primera División;2024/2025
29.03.25;Atlético Madrid;Valencia CF;3;0;24;Primera División;2024/2025
30.03.25;Athletic Club;Deportivo La Coruña;2;0;24;Primera División;2024/2025
30.03.25;Granada CF;FC Barcelona;0;2;24;Primera División;2024/2025
30.03.25;FC Badalona Women;Sevilla FC;0;0;24;Primera División;2024/2025
30.03.25;Real Madrid;Real Sociedad;3;0;24;Primera División;2024/2025
12.04.25;Sevilla FC;Madrid CFF;2;1;25;Primera División;2024/2025
12.04.25;Real Betis;Real Sociedad;3;1;25;Primera División;2024/2025
12.04.25;Deportivo La Coruña;FC Badalona Women;3;1;25;Primera División;2024/2025
12.04.25;SD Eibar;Real Madrid;0;3;25;Primera División;2024/2025
13.04.25;FC Barcelona;Atlético Madrid;6;0;25;Primera División;2024/2025
13.04.25;Costa Adeje Tenerife;Granada CF;1;2;25;Primera División;2024/2025
13.04.25;Athletic Club;Levante UD;2;3;25;Primera División;2024/2025
13.04.25;Valencia CF;Espanyol Barcelona;1;1;25;Primera División;2024/2025
16.04.25;FC Barcelona;Sevilla FC;5;1;26;Primera División;2024/2025
18.04.25;Real Sociedad;SD Eibar;0;0;26;Primera División;2024/2025
18.04.25;Atlético Madrid;Costa Adeje Tenerife;2;0;26;Primera División;2024/2025
19.04.25;Granada CF;Valencia CF;2;1;26;Primera División;2024/2025
19.04.25;Madrid CFF;Athletic Club;1;1;26;Primera División;2024/2025
19.04.25;Espanyol Barcelona;FC Badalona Women;2;0;26;Primera División;2024/2025
19.04.25;Levante UD;Deportivo La Coruña;2;1;26;Primera División;2024/2025
20.04.25;Real Madrid;Real Betis;5;1;26;Primera División;2024/2025
25.04.25;Real Madrid;Madrid CFF;7;3;27;Primera División;2024/2025
26.04.25;Deportivo La Coruña;Granada CF;1;2;27;Primera División;2024/2025
26.04.25;SD Eibar;Espanyol Barcelona;1;1;27;Primera División;2024/2025
27.04.25;Athletic Club;Costa Adeje Tenerife;2;0;27;Primera División;2024/2025
27.04.25;Levante UD;Atlético Madrid;2;2;27;Primera División;2024/2025
27.04.25;Real Sociedad;Valencia CF;0;2;27;Primera División;2024/2025
27.04.25;Real Betis;Sevilla FC;1;1;27;Primera División;2024/2025
01.05.25;FC Badalona Women;FC Barcelona;0;2;27;Primera División;2024/2025
03.05.25;Valencia CF;SD Eibar;2;0;28;Primera División;2024/2025
03.05.25;Costa Adeje Tenerife;Real Betis;2;0;28;Primera División;2024/2025
03.05.25;Sevilla FC;Levante UD;2;0;28;Primera División;2024/2025
03.05.25;Espanyol Barcelona;Real Sociedad;0;3;28;Primera División;2024/2025
04.05.25;Atlético Madrid;Athletic Club;1;0;28;Primera División;2024/2025
04.05.25;Madrid CFF;FC Badalona Women;1;2;28;Primera División;2024/2025
04.05.25;Granada CF;Real Madrid;1;2;28;Primera División;2024/2025
04.05.25;FC Barcelona;Deportivo La Coruña;4;0;28;Primera División;2024/2025
11.05.25;Athletic Club;Espanyol Barcelona;1;0;29;Primera División;2024/2025
11.05.25;FC Badalona Women;Valencia CF;1;1;29;Primera División;2024/2025
11.05.25;Levante UD;Madrid CFF;0;0;29;Primera División;2024/2025
11.05.25;Real Betis;FC Barcelona;0;9;29;Primera División;2024/2025
11.05.25;Real Madrid;Costa Adeje Tenerife;1;1;29;Primera División;2024/2025
11.05.25;Deportivo La Coruña;Sevilla FC;1;1;29;Primera División;2024/2025
11.05.25;SD Eibar;Atlético Madrid;0;2;29;Primera División;2024/2025
11.05.25;Real Sociedad;Granada CF;4;2;29;Primera División;2024/2025
18.05.25;Atlético Madrid;FC Badalona Women;5;0;30;Primera División;2024/2025
18.05.25;Granada CF;Levante UD;0;1;30;Primera División;2024/2025
18.05.25;FC Barcelona;Athletic Club;6;0;30;Primera División;2024/2025
18.05.25;Espanyol Barcelona;Real Betis;6;2;30;Primera División;2024/2025
18.05.25;Valencia CF;Real Madrid;2;2;30;Primera División;2024/2025
18.05.25;Costa Adeje Tenerife;Real Sociedad;4;1;30;Primera División;2024/2025
18.05.25;Sevilla FC;SD Eibar;1;3;30;Primera División;2024/2025
18.05.25;Madrid CFF;Deportivo La Coruña;4;3;30;Primera División;2024/2025
30.08.25;Athletic Club;Costa Adeje Tenerife;0;0;1;Primera División;2025/2026
30.08.25;Levante UD;Granada CF;1;2;1;Primera División;2025/2026
30.08.25;Deportivo La Coruña;FC Badalona Women;0;0;1;Primera División;2025/2026
30.08.25;FC Barcelona;Alhama CF;8;0;1;Primera División;2025/2026
31.08.25;Espanyol Barcelona;Atlético Madrid;0;5;1;Primera División;2025/2026
31.08.25;SD Eibar;Sevilla FC;0;1;1;Primera División;2025/2026
31.08.25;Madrid CFF;Real Sociedad;2;2;1;Primera División;2025/2026
31.08.25;DUX Logroño;Real Madrid;2;2;1;Primera División;2025/2026
05.09.25;Atlético Madrid;Real Madrid;2;1;2;Primera División;2025/2026
06.09.25;Espanyol Barcelona;Deportivo La Coruña;1;1;2;Primera División;2025/2026
06.09.25;Sevilla FC;Costa Adeje Tenerife;0;4;2;Primera División;2025/2026
06.09.25;Madrid CFF;SD Eibar;1;0;2;Primera División;2025/2026
06.09.25;DUX Logroño;Real Sociedad;0;1;2;Primera División;2025/2026
07.09.25;Athletic Club;FC Barcelona;1;8;2;Primera División;2025/2026
07.09.25;Granada CF;FC Badalona Women;0;2;2;Primera División;2025/2026
07.09.25;Levante UD;Alhama CF;0;0;2;Primera División;2025/2026
12.09.25;FC Barcelona;DUX Logroño;4;0;3;Primera División;2025/2026
13.09.25;Real Sociedad;Sevilla FC;3;0;3;Primera División;2025/2026
13.09.25;Costa Adeje Tenerife;Espanyol Barcelona;0;0;3;Primera División;2025/2026
13.09.25;Alhama CF;Granada CF;1;1;3;Primera División;2025/2026
14.09.25;Deportivo La Coruña;Athletic Club;1;0;3;Primera División;2025/2026
14.09.25;SD Eibar;FC Badalona Women;0;0;3;Primera División;2025/2026
14.09.25;Real Madrid;Madrid CFF;2;1;3;Primera División;2025/2026
14.09.25;Atlético Madrid;Levante UD;4;0;3;Primera División;2025/2026
20.09.25;Espanyol Barcelona;Athletic Club;1;1;4;Primera División;2025/2026
20.09.25;Granada CF;SD Eibar;3;1;4;Primera División;2025/2026
20.09.25;FC Badalona Women;DUX Logroño;0;0;4;Primera División;2025/2026
20.09.25;Real Sociedad;Levante UD;2;1;4;Primera División;2025/2026
21.09.25;Alhama CF;Costa Adeje Tenerife;0;4;4;Primera División;2025/2026
21.09.25;Madrid CFF;Atlético Madrid;1;1;4;Primera División;2025/2026
21.09.25;Sevilla FC;FC Barcelona;0;5;4;Primera División;2025/2026
21.09.25;Real Madrid;Deportivo La Coruña;4;0;4;Primera División;2025/2026
27.09.25;FC Badalona Women;Real Sociedad;0;2;5;Primera División;2025/2026
27.09.25;DUX Logroño;Alhama CF;2;4;5;Primera División;2025/2026
27.09.25;FC Barcelona;Espanyol Barcelona;2;0;5;Primera División;2025/2026
28.09.25;Athletic Club;Sevilla FC;1;1;5;Primera División;2025/2026
28.09.25;Granada CF;Atlético Madrid;0;4;5;Primera División;2025/2026
28.09.25;Levante UD;SD Eibar;0;1;5;Primera División;2025/2026
28.09.25;Deportivo La Coruña;Madrid CFF;1;2;5;Primera División;2025/2026
28.09.25;Costa Adeje Tenerife;Real Madrid;0;0;5;Primera División;2025/2026
04.10.25;Atlético Madrid;Athletic Club;1;1;6;Primera División;2025/2026
04.10.25;Real Sociedad;Costa Adeje Tenerife;1;2;6;Primera División;2025/2026
04.10.25;SD Eibar;FC Barcelona;0;4;6;Primera División;2025/2026
04.10.25;Real Madrid;FC Badalona Women;3;0;6;Primera División;2025/2026
04.10.25;Sevilla FC;Espanyol Barcelona;1;0;6;Primera División;2025/2026
05.10.25;Alhama CF;Deportivo La Coruña;3;1;6;Primera División;2025/2026
05.10.25;DUX Logroño;Granada CF;1;1;6;Primera División;2025/2026
05.10.25;Madrid CFF;Levante UD;2;0;6;Primera División;2025/2026
11.10.25;FC Badalona Women;Madrid CFF;1;0;7;Primera División;2025/2026
11.10.25;Granada CF;Real Sociedad;2;2;7;Primera División;2025/2026
11.10.25;Espanyol Barcelona;Alhama CF;3;0;7;Primera División;2025/2026
11.10.25;Deportivo La Coruña;DUX Logroño;2;2;7;Primera División;2025/2026
12.10.25;Atlético Madrid;FC Barcelona;0;6;7;Primera División;2025/2026
12.10.25;Costa Adeje Tenerife;SD Eibar;0;1;7;Primera División;2025/2026
12.10.25;Levante UD;Sevilla FC;0;1;7;Primera División;2025/2026
12.10.25;Athletic Club;Real Madrid;1;4;7;Primera División;2025/2026
18.10.25;Alhama CF;Athletic Club;0;0;8;Primera División;2025/2026
18.10.25;DUX Logroño;Espanyol Barcelona;0;2;8;Primera División;2025/2026
19.10.25;Deportivo La Coruña;Atlético Madrid;1;1;8;Primera División;2025/2026
19.10.25;Sevilla FC;Madrid CFF;1;3;8;Primera División;2025/2026
19.10.25;SD Eibar;Real Sociedad;0;3;8;Primera División;2025/2026
19.10.25;Real Madrid;Levante UD;4;0;8;Primera División;2025/2026
19.10.25;Costa Adeje Tenerife;FC Badalona Women;2;2;8;Primera División;2025/2026
19.10.25;FC Barcelona;Granada CF;2;0;8;Primera División;2025/2026
01.11.25;Atlético Madrid;Alhama CF;4;0;9;Primera División;2025/2026
01.11.25;FC Badalona Women;Sevilla FC;0;0;9;Primera División;2025/2026
01.11.25;Levante UD;Costa Adeje Tenerife;2;4;9;Primera División;2025/2026
01.11.25;Madrid CFF;Granada CF;0;1;9;Primera División;2025/2026
01.11.25;SD Eibar;Deportivo La Coruña;1;0;9;Primera División;2025/2026
01.11.25;Espanyol Barcelona;Real Madrid;0;1;9;Primera División;2025/2026
02.11.25;Athletic Club;DUX Logroño;0;0;9;Primera División;2025/2026
02.11.25;Real Sociedad;FC Barcelona;1;0;9;Primera División;2025/2026
08.11.25;Athletic Club;SD Eibar;2;0;10;Primera División;2025/2026
08.11.25;Real Madrid;Alhama CF;5;0;10;Primera División;2025/2026
09.11.25;FC Badalona Women;Levante UD;1;1;10;Primera División;2025/2026
09.11.25;DUX Logroño;Atlético Madrid;0;5;10;Primera División;2025/2026
09.11.25;FC Barcelona;Deportivo La Coruña;8;0;10;Primera División;2025/2026
09.11.25;Granada CF;Sevilla FC;0;2;10;Primera División;2025/2026
09.11.25;Espanyol Barcelona;Real Sociedad;2;3;10;Primera División;2025/2026
09.11.25;Madrid CFF;Costa Adeje Tenerife;0;2;10;Primera División;2025/2026
14.11.25;Deportivo La Coruña;Levante UD;1;0;11;Primera División;2025/2026
15.11.25;Alhama CF;Madrid CFF;1;4;11;Primera División;2025/2026
15.11.25;FC Barcelona;Real Madrid;4;0;11;Primera División;2025/2026
16.11.25;Atlético Madrid;FC Badalona Women;2;0;11;Primera División;2025/2026
16.11.25;Real Sociedad;Athletic Club;1;1;11;Primera División;2025/2026
16.11.25;Costa Adeje Tenerife;Granada CF;2;2;11;Primera División;2025/2026
16.11.25;Sevilla FC;DUX Logroño;1;0;11;Primera División;2025/2026
16.11.25;SD Eibar;Espanyol Barcelona;1;2;11;Primera División;2025/2026
22.11.25;Granada CF;Athletic Club;1;5;12;Primera División;2025/2026
22.11.25;Sevilla FC;Deportivo La Coruña;3;1;12;Primera División;2025/2026
22.11.25;FC Badalona Women;Espanyol Barcelona;1;1;12;Primera División;2025/2026
22.11.25;Madrid CFF;DUX Logroño;1;0;12;Primera División;2025/2026
23.11.25;Real Sociedad;Alhama CF;3;1;12;Primera División;2025/2026
23.11.25;Costa Adeje Tenerife;Atlético Madrid;2;1;12;Primera División;2025/2026
23.11.25;Real Madrid;SD Eibar;3;0;12;Primera División;2025/2026
23.11.25;Levante UD;FC Barcelona;0;4;12;Primera División;2025/2026
06.12.25;Atlético Madrid;Sevilla FC;2;2;13;Primera División;2025/2026
06.12.25;Deportivo La Coruña;Granada CF;2;0;13;Primera División;2025/2026
06.12.25;FC Barcelona;Costa Adeje Tenerife;2;0;13;Primera División;2025/2026
06.12.25;Espanyol Barcelona;Madrid CFF;2;5;13;Primera División;2025/2026
06.12.25;Real Madrid;Real Sociedad;1;0;13;Primera División;2025/2026
07.12.25;Alhama CF;FC Badalona Women;0;1;13;Primera División;2025/2026
07.12.25;Athletic Club;Levante UD;1;0;13;Primera División;2025/2026
07.12.25;DUX Logroño;SD Eibar;0;1;13;Primera División;2025/2026
13.12.25;Granada CF;Real Madrid;0;3;14;Primera División;2025/2026
13.12.25;Levante UD;Espanyol Barcelona;0;1;14;Primera División;2025/2026
13.12.25;FC Badalona Women;FC Barcelona;1;5;14;Primera División;2025/2026
13.12.25;Sevilla FC;Alhama CF;2;1;14;Primera División;2025/2026
13.12.25;Madrid CFF;Athletic Club;0;2;14;Primera División;2025/2026
14.12.25;Costa Adeje Tenerife;DUX Logroño;1;1;14;Primera División;2025/2026
14.12.25;Real Sociedad;Deportivo La Coruña;3;0;14;Primera División;2025/2026
14.12.25;SD Eibar;Atlético Madrid;2;2;14;Primera División;2025/2026
10.01.26;Alhama CF;SD Eibar;0;1;15;Primera División;2025/2026
10.01.26;Atlético Madrid;Real Sociedad;5;5;15;Primera División;2025/2026
10.01.26;Athletic Club;FC Badalona Women;0;0;15;Primera División;2025/2026
10.01.26;Real Madrid;Sevilla FC;2;0;15;Primera División;2025/2026
10.01.26;FC Barcelona;Madrid CFF;12;1;15;Primera División;2025/2026
11.01.26;Deportivo La Coruña;Costa Adeje Tenerife;1;1;15;Primera División;2025/2026
11.01.26;DUX Logroño;Levante UD;2;3;15;Primera División;2025/2026
11.01.26;Espanyol Barcelona;Granada CF;0;2;15;Primera División;2025/2026
17.01.26;Granada CF;DUX Logroño;1;0;16;Primera División;2025/2026
17.01.26;Levante UD;Real Madrid;1;2;16;Primera División;2025/2026
17.01.26;Atlético Madrid;Espanyol Barcelona;0;1;16;Primera División;2025/2026
17.01.26;SD Eibar;Madrid CFF;1;3;16;Primera División;2025/2026
18.01.26;Alhama CF;FC Barcelona;0;2;16;Primera División;2025/2026
18.01.26;FC Badalona Women;Deportivo La Coruña;1;0;16;Primera División;2025/2026
18.01.26;Costa Adeje Tenerife;Athletic Club;5;0;16;Primera División;2025/2026
18.01.26;Sevilla FC;Real Sociedad;0;2;16;Primera División;2025/2026
13.01.26;Real Madrid;Athletic Club;0;1;17;Primera División;2025/2026
14.01.26;FC Barcelona;Atlético Madrid;5;0;17;Primera División;2025/2026
25.01.26;Espanyol Barcelona;Costa Adeje Tenerife;0;0;17;Primera División;2025/2026
25.01.26;Sevilla FC;Levante UD;4;2;17;Primera División;2025/2026
25.01.26;Real Sociedad;SD Eibar;3;0;17;Primera División;2025/2026
25.01.26;DUX Logroño;Deportivo La Coruña;0;4;17;Primera División;2025/2026
25.01.26;Madrid CFF;FC Badalona Women;0;1;17;Primera División;2025/2026
25.01.26;Granada CF;Alhama CF;2;0;17;Primera División;2025/2026
31.01.26;Atlético Madrid;Granada CF;1;1;18;Primera División;2025/2026
31.01.26;Levante UD;Madrid CFF;2;1;18;Primera División;2025/2026
31.01.26;Athletic Club;Espanyol Barcelona;2;1;18;Primera División;2025/2026
31.01.26;Alhama CF;DUX Logroño;0;4;18;Primera División;2025/2026
01.02.26;FC Badalona Women;SD Eibar;2;1;18;Primera División;2025/2026
01.02.26;Deportivo La Coruña;Real Madrid;2;4;18;Primera División;2025/2026
01.02.26;Costa Adeje Tenerife;Real Sociedad;1;1;18;Primera División;2025/2026
01.02.26;FC Barcelona;Sevilla FC;4;1;18;Primera División;2025/2026
07.02.26;SD Eibar;Granada CF;0;2;19;Primera División;2025/2026
08.02.26;Costa Adeje Tenerife;Alhama CF;1;0;19;Primera División;2025/2026
08.02.26;Sevilla FC;Athletic Club;4;0;19;Primera División;2025/2026
08.02.26;Levante UD;Atlético Madrid;0;1;19;Primera División;2025/2026
08.02.26;Madrid CFF;Deportivo La Coruña;1;6;19;Primera División;2025/2026
08.02.26;Real Madrid;Espanyol Barcelona;3;0;19;Primera División;2025/2026
08.02.26;Real Sociedad;FC Badalona Women;2;0;19;Primera División;2025/2026
08.02.26;DUX Logroño;FC Barcelona;0;3;19;Primera División;2025/2026
14.02.26;FC Badalona Women;Costa Adeje Tenerife;0;2;20;Primera División;2025/2026
14.02.26;Granada CF;Levante UD;1;0;20;Primera División;2025/2026
14.02.26;Deportivo La Coruña;Sevilla FC;0;4;20;Primera División;2025/2026
14.02.26;FC Barcelona;SD Eibar;4;0;20;Primera División;2025/2026
15.02.26;Alhama CF;Real Madrid;0;3;20;Primera División;2025/2026
15.02.26;Athletic Club;Real Sociedad;0;2;20;Primera División;2025/2026
15.02.26;Espanyol Barcelona;DUX Logroño;1;1;20;Primera División;2025/2026
15.02.26;Atlético Madrid;Madrid CFF;0;0;20;Primera División;2025/2026
21.02.26;Madrid CFF;Alhama CF;5;0;21;Primera División;2025/2026
21.02.26;Levante UD;Deportivo La Coruña;1;2;21;Primera División;2025/2026
21.02.26;DUX Logroño;FC Badalona Women;2;3;21;Primera División;2025/2026
21.02.26;Granada CF;FC Barcelona;0;2;21;Primera División;2025/2026
22.02.26;Real Madrid;Costa Adeje Tenerife;2;0;21;Primera División;2025/2026
22.02.26;SD Eibar;Athletic Club;0;1;21;Primera División;2025/2026
22.02.26;Real Sociedad;Espanyol Barcelona;2;1;21;Primera División;2025/2026
22.02.26;Sevilla FC;Atlético Madrid;2;1;21;Primera División;2025/2026
14.03.26;Atlético Madrid;DUX Logroño;5;0;22;Primera División;2025/2026
14.03.26;Costa Adeje Tenerife;Levante UD;4;0;22;Primera División;2025/2026
14.03.26;Real Sociedad;Real Madrid;0;3;22;Primera División;2025/2026
15.03.26;Alhama CF;Sevilla FC;0;1;22;Primera División;2025/2026
15.03.26;Deportivo La Coruña;FC Barcelona;0;2;22;Primera División;2025/2026
15.03.26;FC Badalona Women;Granada CF;0;4;22;Primera División;2025/2026
15.03.26;Athletic Club;Madrid CFF;4;1;22;Primera División;2025/2026
16.03.26;Espanyol Barcelona;SD Eibar;2;0;22;Primera División;2025/2026
21.03.26;Madrid CFF;Espanyol Barcelona;1;1;23;Primera División;2025/2026
21.03.26;Levante UD;Real Sociedad;0;1;23;Primera División;2025/2026
21.03.26;FC Barcelona;Athletic Club;7;1;23;Primera División;2025/2026
22.03.26;Alhama CF;Atlético Madrid;1;2;23;Primera División;2025/2026
22.03.26;DUX Logroño;Costa Adeje Tenerife;0;1;23;Primera División;2025/2026
22.03.26;Sevilla FC;FC Badalona Women;1;5;23;Primera División;2025/2026
22.03.26;SD Eibar;Real Madrid;0;1;23;Primera División;2025/2026
23.03.26;Granada CF;Deportivo La Coruña;1;0;23;Primera División;2025/2026
28.03.26;FC Badalona Women;Alhama CF;3;2;24;Primera División;2025/2026
28.03.26;Espanyol Barcelona;Levante UD;1;0;24;Primera División;2025/2026
28.03.26;Deportivo La Coruña;SD Eibar;2;1;24;Primera División;2025/2026
28.03.26;Sevilla FC;Granada CF;0;1;24;Primera División;2025/2026
29.03.26;Real Sociedad;DUX Logroño;1;1;24;Primera División;2025/2026
29.03.26;Costa Adeje Tenerife;Madrid CFF;2;0;24;Primera División;2025/2026
29.03.26;Athletic Club;Atlético Madrid;1;2;24;Primera División;2025/2026
29.03.26;Real Madrid;FC Barcelona;0;3;24;Primera División;2025/2026
03.04.26;SD Eibar;Costa Adeje Tenerife;0;0;25;Primera División;2025/2026
04.04.26;Alhama CF;Real Sociedad;1;5;25;Primera División;2025/2026
04.04.26;DUX Logroño;Sevilla FC;2;1;25;Primera División;2025/2026
04.04.26;Granada CF;Espanyol Barcelona;2;0;25;Primera División;2025/2026
05.04.26;Atlético Madrid;Deportivo La Coruña;2;0;25;Primera División;2025/2026
05.04.26;Levante UD;Athletic Club;0;1;25;Primera División;2025/2026
05.04.26;Madrid CFF;Real Madrid;0;2;25;Primera División;2025/2026
06.04.26;FC Barcelona;FC Badalona Women;6;0;25;Primera División;2025/2026
22.04.26;Espanyol Barcelona;FC Barcelona;1;4;26;Primera División;2025/2026
25.04.26;Athletic Club;Granada CF;1;2;26;Primera División;2025/2026
25.04.26;FC Badalona Women;Atlético Madrid;2;4;26;Primera División;2025/2026
25.04.26;SD Eibar;Levante UD;2;1;26;Primera División;2025/2026
26.04.26;Deportivo La Coruña;Alhama CF;2;2;26;Primera División;2025/2026
26.04.26;Costa Adeje Tenerife;Sevilla FC;3;0;26;Primera División;2025/2026
26.04.26;Real Sociedad;Madrid CFF;2;0;26;Primera División;2025/2026
26.04.26;Real Madrid;DUX Logroño;1;1;26;Primera División;2025/2026
01.05.26;Alhama CF;Espanyol Barcelona;3;1;27;Primera División;2025/2026
01.05.26;Granada CF;Costa Adeje Tenerife;1;1;27;Primera División;2025/2026
02.05.26;FC Badalona Women;Athletic Club;0;1;27;Primera División;2025/2026
02.05.26;DUX Logroño;Madrid CFF;3;0;27;Primera División;2025/2026
02.05.26;Sevilla FC;Real Madrid;0;2;27;Primera División;2025/2026
03.05.26;Atlético Madrid;SD Eibar;4;0;27;Primera División;2025/2026
03.05.26;Deportivo La Coruña;Real Sociedad;1;2;27;Primera División;2025/2026
06.05.26;FC Barcelona;Levante UD;5;0;27;Primera División;2025/2026
09.05.26;Espanyol Barcelona;FC Badalona Women;1;1;28;Primera División;2025/2026
09.05.26;Real Sociedad;Granada CF;3;0;28;Primera División;2025/2026
09.05.26;SD Eibar;Alhama CF;2;0;28;Primera División;2025/2026
09.05.26;Athletic Club;Deportivo La Coruña;0;1;28;Primera División;2025/2026
10.05.26;Levante UD;DUX Logroño;1;4;28;Primera División;2025/2026
10.05.26;Real Madrid;Atlético Madrid;1;0;28;Primera División;2025/2026
10.05.26;Costa Adeje Tenerife;FC Barcelona;1;3;28;Primera División;2025/2026
11.05.26;Madrid CFF;Sevilla FC;2;0;28;Primera División;2025/2026
26.05.26;Alhama CF;Levante UD;2;2;29;Primera División;2025/2026
26.05.26;Atlético Madrid;Costa Adeje Tenerife;2;2;29;Primera División;2025/2026
26.05.26;FC Badalona Women;Real Madrid;0;4;29;Primera División;2025/2026
27.05.26;Deportivo La Coruña;Espanyol Barcelona;2;2;29;Primera División;2025/2026
26.05.26;DUX Logroño;Athletic Club;0;2;29;Primera División;2025/2026
27.05.26;FC Barcelona;Real Sociedad;2;1;29;Primera División;2025/2026
26.05.26;Granada CF;Madrid CFF;3;4;29;Primera División;2025/2026
26.05.26;Sevilla FC;SD Eibar;0;0;29;Primera División;2025/2026
31.05.26;Athletic Club;Alhama CF;;;30;Primera División;2025/2026
31.05.26;Costa Adeje Tenerife;Deportivo La Coruña;;;30;Primera División;2025/2026
31.05.26;Espanyol Barcelona;Sevilla FC;;;30;Primera División;2025/2026
31.05.26;Madrid CFF;FC Barcelona;;;30;Primera División;2025/2026
31.05.26;Real Madrid;Granada CF;;;30;Primera División;2025/2026
31.05.26;Real Sociedad;Atlético Madrid;;;30;Primera División;2025/2026
31.05.26;SD Eibar;DUX Logroño;;;30;Primera División;2025/2026
31.05.26;Levante UD;FC Badalona Women;;;30;Primera División;2025/2026
28.08.21;Empoli FC;AS Roma;0;3;1;Serie A;2021/2022
28.08.21;Juventus;Pomigliano CF;3;0;1;Serie A;2021/2022
28.08.21;Napoli Femminile;Inter;0;3;1;Serie A;2021/2022
29.08.21;AC Milan;Hellas Verona;4;0;1;Serie A;2021/2022
29.08.21;Lazio Roma;UC Sampdoria;1;2;1;Serie A;2021/2022
29.08.21;Sassuolo Calcio;ACF Fiorentina;2;1;1;Serie A;2021/2022
04.09.21;AS Roma;Napoli Femminile;4;1;2;Serie A;2021/2022
04.09.21;UC Sampdoria;AC Milan;0;1;2;Serie A;2021/2022
04.09.21;Hellas Verona;Sassuolo Calcio;0;4;2;Serie A;2021/2022
05.09.21;ACF Fiorentina;Juventus;0;3;2;Serie A;2021/2022
05.09.21;Inter;Lazio Roma;1;0;2;Serie A;2021/2022
05.09.21;Pomigliano CF;Empoli FC;2;2;2;Serie A;2021/2022
11.09.21;Lazio Roma;AC Milan;1;8;3;Serie A;2021/2022
11.09.21;Pomigliano CF;AS Roma;1;2;3;Serie A;2021/2022
11.09.21;Sassuolo Calcio;UC Sampdoria;2;0;3;Serie A;2021/2022
12.09.21;Empoli FC;Inter;1;4;3;Serie A;2021/2022
12.09.21;Juventus;Hellas Verona;3;0;3;Serie A;2021/2022
12.09.21;Napoli Femminile;ACF Fiorentina;1;0;3;Serie A;2021/2022
25.09.21;Juventus;Empoli FC;1;0;4;Serie A;2021/2022
25.09.21;AC Milan;Sassuolo Calcio;0;2;4;Serie A;2021/2022
25.09.21;Hellas Verona;Napoli Femminile;0;0;4;Serie A;2021/2022
26.09.21;Lazio Roma;ACF Fiorentina;1;6;4;Serie A;2021/2022
14.10.21;UC Sampdoria;Pomigliano CF;1;0;4;Serie A;2021/2022
16.10.21;Inter;AS Roma;1;0;4;Serie A;2021/2022
02.10.21;ACF Fiorentina;UC Sampdoria;4;2;5;Serie A;2021/2022
02.10.21;AS Roma;Juventus;1;2;5;Serie A;2021/2022
02.10.21;Empoli FC;Hellas Verona;3;1;5;Serie A;2021/2022
03.10.21;Napoli Femminile;AC Milan;0;1;5;Serie A;2021/2022
03.10.21;Pomigliano CF;Inter;2;0;5;Serie A;2021/2022
03.10.21;Sassuolo Calcio;Lazio Roma;3;0;5;Serie A;2021/2022
09.10.21;UC Sampdoria;Inter;3;0;6;Serie A;2021/2022
09.10.21;Juventus;Napoli Femminile;2;0;6;Serie A;2021/2022
09.10.21;Lazio Roma;Pomigliano CF;1;2;6;Serie A;2021/2022
10.10.21;AC Milan;AS Roma;1;1;6;Serie A;2021/2022
10.10.21;Hellas Verona;ACF Fiorentina;1;3;6;Serie A;2021/2022
10.10.21;Sassuolo Calcio;Empoli FC;3;2;6;Serie A;2021/2022
30.10.21;Empoli FC;Lazio Roma;2;0;7;Serie A;2021/2022
30.10.21;Inter;Juventus;1;2;7;Serie A;2021/2022
30.10.21;Pomigliano CF;Hellas Verona;2;1;7;Serie A;2021/2022
31.10.21;AS Roma;Sassuolo Calcio;2;0;7;Serie A;2021/2022
31.10.21;ACF Fiorentina;AC Milan;0;1;7;Serie A;2021/2022
31.10.21;Napoli Femminile;UC Sampdoria;0;1;7;Serie A;2021/2022
05.11.21;UC Sampdoria;Juventus;0;1;8;Serie A;2021/2022
06.11.21;ACF Fiorentina;Inter;2;3;8;Serie A;2021/2022
06.11.21;Hellas Verona;AS Roma;1;5;8;Serie A;2021/2022
07.11.21;Sassuolo Calcio;Pomigliano CF;4;2;8;Serie A;2021/2022
07.11.21;AC Milan;Empoli FC;1;0;8;Serie A;2021/2022
07.11.21;Lazio Roma;Napoli Femminile;3;4;8;Serie A;2021/2022
13.11.21;Juventus;Lazio Roma;5;0;9;Serie A;2021/2022
13.11.21;AS Roma;ACF Fiorentina;1;0;9;Serie A;2021/2022
13.11.21;Napoli Femminile;Sassuolo Calcio;0;1;9;Serie A;2021/2022
14.11.21;Pomigliano CF;AC Milan;0;2;9;Serie A;2021/2022
14.11.21;Empoli FC;UC Sampdoria;2;2;9;Serie A;2021/2022
14.11.21;Inter;Hellas Verona;5;0;9;Serie A;2021/2022
04.12.21;Lazio Roma;Hellas Verona;1;0;10;Serie A;2021/2022
04.12.21;ACF Fiorentina;Pomigliano CF;3;1;10;Serie A;2021/2022
04.12.21;Sassuolo Calcio;Juventus;0;2;10;Serie A;2021/2022
05.12.21;UC Sampdoria;AS Roma;1;2;10;Serie A;2021/2022
05.12.21;AC Milan;Inter;0;3;10;Serie A;2021/2022
05.12.21;Napoli Femminile;Empoli FC;0;1;10;Serie A;2021/2022
11.12.21;Pomigliano CF;Napoli Femminile;2;1;11;Serie A;2021/2022
11.12.21;Hellas Verona;UC Sampdoria;1;2;11;Serie A;2021/2022
11.12.21;Inter;Sassuolo Calcio;2;2;11;Serie A;2021/2022
12.12.21;AS Roma;Lazio Roma;3;2;11;Serie A;2021/2022
12.12.21;Empoli FC;ACF Fiorentina;1;1;11;Serie A;2021/2022
12.12.21;Juventus;AC Milan;5;2;11;Serie A;2021/2022
15.01.22;AS Roma;Empoli FC;2;1;12;Serie A;2021/2022
15.01.22;UC Sampdoria;Lazio Roma;2;1;12;Serie A;2021/2022
15.01.22;Hellas Verona;AC Milan;0;6;12;Serie A;2021/2022
16.01.22;Pomigliano CF;Juventus;0;5;12;Serie A;2021/2022
16.01.22;ACF Fiorentina;Sassuolo Calcio;1;6;12;Serie A;2021/2022
16.01.22;Inter;Napoli Femminile;1;1;12;Serie A;2021/2022
22.01.22;Sassuolo Calcio;Hellas Verona;4;0;13;Serie A;2021/2022
22.01.22;Empoli FC;Pomigliano CF;1;2;13;Serie A;2021/2022
22.01.22;Juventus;ACF Fiorentina;2;2;13;Serie A;2021/2022
23.01.22;Napoli Femminile;AS Roma;0;1;13;Serie A;2021/2022
23.01.22;AC Milan;UC Sampdoria;4;0;13;Serie A;2021/2022
23.01.22;Lazio Roma;Inter;1;3;13;Serie A;2021/2022
05.02.22;AC Milan;Lazio Roma;3;1;14;Serie A;2021/2022
05.02.22;AS Roma;Pomigliano CF;5;2;14;Serie A;2021/2022
05.02.22;UC Sampdoria;Sassuolo Calcio;1;3;14;Serie A;2021/2022
06.02.22;ACF Fiorentina;Napoli Femminile;0;2;14;Serie A;2021/2022
06.02.22;Inter;Empoli FC;3;2;14;Serie A;2021/2022
06.02.22;Hellas Verona;Juventus;0;1;14;Serie A;2021/2022
26.02.22;ACF Fiorentina;Lazio Roma;2;2;15;Serie A;2021/2022
26.02.22;Napoli Femminile;Hellas Verona;2;1;15;Serie A;2021/2022
26.02.22;Sassuolo Calcio;AC Milan;0;0;15;Serie A;2021/2022
27.02.22;Empoli FC;Juventus;2;1;15;Serie A;2021/2022
27.02.22;AS Roma;Inter;2;0;15;Serie A;2021/2022
27.02.22;Pomigliano CF;UC Sampdoria;0;1;15;Serie A;2021/2022
05.03.22;UC Sampdoria;ACF Fiorentina;2;0;16;Serie A;2021/2022
05.03.22;Juventus;AS Roma;1;1;16;Serie A;2021/2022
05.03.22;Hellas Verona;Empoli FC;0;1;16;Serie A;2021/2022
06.03.22;Lazio Roma;Sassuolo Calcio;3;1;16;Serie A;2021/2022
06.03.22;AC Milan;Napoli Femminile;1;1;16;Serie A;2021/2022
06.03.22;Inter;Pomigliano CF;0;1;16;Serie A;2021/2022
19.03.22;Napoli Femminile;Juventus;0;2;17;Serie A;2021/2022
19.03.22;AS Roma;AC Milan;1;1;17;Serie A;2021/2022
19.03.22;Empoli FC;Sassuolo Calcio;1;1;17;Serie A;2021/2022
20.03.22;ACF Fiorentina;Hellas Verona;6;0;17;Serie A;2021/2022
20.03.22;Inter;UC Sampdoria;4;3;17;Serie A;2021/2022
16.04.22;Pomigliano CF;Lazio Roma;1;1;17;Serie A;2021/2022
26.03.22;Hellas Verona;Pomigliano CF;2;0;18;Serie A;2021/2022
26.03.22;Lazio Roma;Empoli FC;0;0;18;Serie A;2021/2022
26.03.22;Sassuolo Calcio;AS Roma;0;3;18;Serie A;2021/2022
27.03.22;AC Milan;ACF Fiorentina;2;0;18;Serie A;2021/2022
27.03.22;Juventus;Inter;3;1;18;Serie A;2021/2022
27.03.22;UC Sampdoria;Napoli Femminile;1;0;18;Serie A;2021/2022
02.04.22;Pomigliano CF;Sassuolo Calcio;0;3;19;Serie A;2021/2022
02.04.22;Inter;ACF Fiorentina;2;0;19;Serie A;2021/2022
02.04.22;Napoli Femminile;Lazio Roma;0;1;19;Serie A;2021/2022
03.04.22;AS Roma;Hellas Verona;7;1;19;Serie A;2021/2022
03.04.22;Empoli FC;AC Milan;0;3;19;Serie A;2021/2022
03.04.22;Juventus;UC Sampdoria;3;1;19;Serie A;2021/2022
23.04.22;Hellas Verona;Inter;0;4;20;Serie A;2021/2022
23.04.22;ACF Fiorentina;AS Roma;2;3;20;Serie A;2021/2022
23.04.22;UC Sampdoria;Empoli FC;1;3;20;Serie A;2021/2022
24.04.22;Lazio Roma;Juventus;1;5;20;Serie A;2021/2022
24.04.22;AC Milan;Pomigliano CF;6;2;20;Serie A;2021/2022
24.04.22;Sassuolo Calcio;Napoli Femminile;0;0;20;Serie A;2021/2022
07.05.22;AS Roma;UC Sampdoria;8;0;21;Serie A;2021/2022
07.05.22;Inter;AC Milan;0;3;21;Serie A;2021/2022
07.05.22;Juventus;Sassuolo Calcio;3;1;21;Serie A;2021/2022
08.05.22;Hellas Verona;Lazio Roma;4;4;21;Serie A;2021/2022
08.05.22;Empoli FC;Napoli Femminile;1;3;21;Serie A;2021/2022
08.05.22;Pomigliano CF;ACF Fiorentina;0;1;21;Serie A;2021/2022
14.05.22;Lazio Roma;AS Roma;0;3;22;Serie A;2021/2022
14.05.22;AC Milan;Juventus;1;2;22;Serie A;2021/2022
14.05.22;Napoli Femminile;Pomigliano CF;1;3;22;Serie A;2021/2022
15.05.22;ACF Fiorentina;Empoli FC;6;0;22;Serie A;2021/2022
15.05.22;UC Sampdoria;Hellas Verona;3;1;22;Serie A;2021/2022
15.05.22;Sassuolo Calcio;Inter;2;1;22;Serie A;2021/2022
27.08.22;FC Como Women;Juventus;0;6;1;Serie A;2022/2023
28.08.22;Pomigliano CF;AS Roma;0;2;1;Serie A;2022/2023
28.08.22;AC Milan;ACF Fiorentina;1;3;1;Serie A;2022/2023
28.08.22;Sassuolo Calcio;UC Sampdoria;1;2;1;Serie A;2022/2023
28.08.22;Inter;Parma Calcio 1913;4;1;1;Serie A;2022/2023
10.09.22;AS Roma;AC Milan;2;0;2;Serie A;2022/2023
11.09.22;UC Sampdoria;Pomigliano CF;2;1;2;Serie A;2022/2023
11.09.22;Juventus;Inter;3;3;2;Serie A;2022/2023
11.09.22;ACF Fiorentina;FC Como Women;2;1;2;Serie A;2022/2023
12.09.22;Parma Calcio 1913;Sassuolo Calcio;2;1;2;Serie A;2022/2023
16.09.22;Juventus;AS Roma;1;0;3;Serie A;2022/2023
17.09.22;Inter;Pomigliano CF;6;1;3;Serie A;2022/2023
18.09.22;ACF Fiorentina;Parma Calcio 1913;2;1;3;Serie A;2022/2023
18.09.22;FC Como Women;UC Sampdoria;0;1;3;Serie A;2022/2023
18.09.22;AC Milan;Sassuolo Calcio;3;1;3;Serie A;2022/2023
24.09.22;Sassuolo Calcio;Juventus;1;1;4;Serie A;2022/2023
24.09.22;Parma Calcio 1913;AC Milan;0;4;4;Serie A;2022/2023
24.09.22;AS Roma;ACF Fiorentina;2;1;4;Serie A;2022/2023
25.09.22;Pomigliano CF;FC Como Women;2;2;4;Serie A;2022/2023
25.09.22;UC Sampdoria;Inter;0;2;4;Serie A;2022/2023
30.09.22;FC Como Women;Inter;1;3;5;Serie A;2022/2023
01.10.22;ACF Fiorentina;Sassuolo Calcio;2;0;5;Serie A;2022/2023
01.10.22;AC Milan;UC Sampdoria;2;1;5;Serie A;2022/2023
02.10.22;Juventus;Pomigliano CF;3;0;5;Serie A;2022/2023
02.10.22;AS Roma;Parma Calcio 1913;5;0;5;Serie A;2022/2023
15.10.22;Pomigliano CF;ACF Fiorentina;0;1;6;Serie A;2022/2023
15.10.22;Inter;AC Milan;4;0;6;Serie A;2022/2023
15.10.22;FC Como Women;Parma Calcio 1913;4;1;6;Serie A;2022/2023
16.10.22;Sassuolo Calcio;AS Roma;0;1;6;Serie A;2022/2023
16.10.22;UC Sampdoria;Juventus;0;4;6;Serie A;2022/2023
22.10.22;Parma Calcio 1913;Pomigliano CF;1;3;7;Serie A;2022/2023
22.10.22;AC Milan;Juventus;4;3;7;Serie A;2022/2023
23.10.22;AS Roma;FC Como Women;1;0;7;Serie A;2022/2023
23.10.22;ACF Fiorentina;UC Sampdoria;2;1;7;Serie A;2022/2023
23.10.22;Sassuolo Calcio;Inter;1;1;7;Serie A;2022/2023
29.10.22;Inter;AS Roma;1;2;8;Serie A;2022/2023
29.10.22;Pomigliano CF;AC Milan;2;1;8;Serie A;2022/2023
30.10.22;Juventus;ACF Fiorentina;2;0;8;Serie A;2022/2023
30.10.22;FC Como Women;Sassuolo Calcio;2;2;8;Serie A;2022/2023
30.10.22;UC Sampdoria;Parma Calcio 1913;0;0;8;Serie A;2022/2023
19.11.22;AS Roma;UC Sampdoria;2;0;9;Serie A;2022/2023
19.11.22;Parma Calcio 1913;Juventus;1;2;9;Serie A;2022/2023
20.11.22;Sassuolo Calcio;Pomigliano CF;2;1;9;Serie A;2022/2023
20.11.22;ACF Fiorentina;Inter;0;0;9;Serie A;2022/2023
20.11.22;AC Milan;FC Como Women;3;3;9;Serie A;2022/2023
26.11.22;AS Roma;Pomigliano CF;2;0;10;Serie A;2022/2023
26.11.22;ACF Fiorentina;AC Milan;1;6;10;Serie A;2022/2023
27.11.22;UC Sampdoria;Sassuolo Calcio;0;2;10;Serie A;2022/2023
27.11.22;Juventus;FC Como Women;1;1;10;Serie A;2022/2023
28.11.22;Parma Calcio 1913;Inter;2;2;10;Serie A;2022/2023
03.12.22;Pomigliano CF;UC Sampdoria;1;0;11;Serie A;2022/2023
03.12.22;Inter;Juventus;0;2;11;Serie A;2022/2023
04.12.22;Sassuolo Calcio;Parma Calcio 1913;2;2;11;Serie A;2022/2023
04.12.22;AC Milan;AS Roma;0;2;11;Serie A;2022/2023
04.12.22;FC Como Women;ACF Fiorentina;2;3;11;Serie A;2022/2023
10.12.22;Pomigliano CF;Inter;1;2;12;Serie A;2022/2023
10.12.22;Parma Calcio 1913;ACF Fiorentina;0;4;12;Serie A;2022/2023
10.12.22;Sassuolo Calcio;AC Milan;0;1;12;Serie A;2022/2023
11.12.22;UC Sampdoria;FC Como Women;0;1;12;Serie A;2022/2023
11.12.22;AS Roma;Juventus;2;4;12;Serie A;2022/2023
14.01.23;FC Como Women;Pomigliano CF;0;1;13;Serie A;2022/2023
14.01.23;Inter;UC Sampdoria;4;0;13;Serie A;2022/2023
14.01.23;ACF Fiorentina;AS Roma;1;7;13;Serie A;2022/2023
15.01.23;AC Milan;Parma Calcio 1913;2;0;13;Serie A;2022/2023
15.01.23;Juventus;Sassuolo Calcio;1;1;13;Serie A;2022/2023
21.01.23;UC Sampdoria;AC Milan;0;3;14;Serie A;2022/2023
21.01.23;Sassuolo Calcio;ACF Fiorentina;0;1;14;Serie A;2022/2023
22.01.23;Pomigliano CF;Juventus;1;2;14;Serie A;2022/2023
22.01.23;Parma Calcio 1913;AS Roma;2;3;14;Serie A;2022/2023
22.01.23;Inter;FC Como Women;1;1;14;Serie A;2022/2023
28.01.23;ACF Fiorentina;Pomigliano CF;2;0;15;Serie A;2022/2023
28.01.23;AC Milan;Inter;1;4;15;Serie A;2022/2023
29.01.23;Juventus;UC Sampdoria;5;0;15;Serie A;2022/2023
29.01.23;AS Roma;Sassuolo Calcio;5;0;15;Serie A;2022/2023
29.01.23;Parma Calcio 1913;FC Como Women;1;0;15;Serie A;2022/2023
04.02.23;FC Como Women;AS Roma;0;1;16;Serie A;2022/2023
04.02.23;UC Sampdoria;ACF Fiorentina;1;4;16;Serie A;2022/2023
04.02.23;Juventus;AC Milan;1;2;16;Serie A;2022/2023
04.02.23;Pomigliano CF;Parma Calcio 1913;0;0;16;Serie A;2022/2023
05.02.23;Inter;Sassuolo Calcio;3;0;16;Serie A;2022/2023
11.02.23;ACF Fiorentina;Juventus;0;3;17;Serie A;2022/2023
11.02.23;AS Roma;Inter;3;2;17;Serie A;2022/2023
12.02.23;Parma Calcio 1913;UC Sampdoria;3;1;17;Serie A;2022/2023
12.02.23;AC Milan;Pomigliano CF;1;0;17;Serie A;2022/2023
12.02.23;Sassuolo Calcio;FC Como Women;2;0;17;Serie A;2022/2023
25.02.23;Inter;ACF Fiorentina;3;1;18;Serie A;2022/2023
25.02.23;Pomigliano CF;Sassuolo Calcio;0;2;18;Serie A;2022/2023
26.03.23;UC Sampdoria;AS Roma;0;1;18;Serie A;2022/2023
26.03.23;FC Como Women;AC Milan;0;4;18;Serie A;2022/2023
26.03.23;Juventus;Parma Calcio 1913;2;1;18;Serie A;2022/2023
18.03.23;Sassuolo Calcio;UC Sampdoria;3;0;1;Serie A - Salvezza;2022/2023
19.03.23;Pomigliano CF;Parma Calcio 1918;4;1;1;Serie A - Salvezza;2022/2023
25.03.23;UC Sampdoria;FC Como Women;1;1;2;Serie A - Salvezza;2022/2023
26.03.23;Parma Calcio 1913;Sassuolo Calcio;0;1;2;Serie A - Salvezza;2022/2023
01.04.23;FC Como Women;Parma Calcio 1918;1;0;3;Serie A - Salvezza;2022/2023
02.04.23;Sassuolo Calcio;Pomigliano CF;2;0;3;Serie A - Salvezza;2022/2023
15.04.23;Pomigliano CF;FC Como Women;1;3;4;Serie A - Salvezza;2022/2023
16.04.23;Parma Calcio 1913;UC Sampdoria;1;1;4;Serie A - Salvezza;2022/2023
23.04.23;UC Sampdoria;Pomigliano CF;4;1;5;Serie A - Salvezza;2022/2023
23.04.23;FC Como Women;Sassuolo Calcio;2;1;5;Serie A - Salvezza;2022/2023
29.04.23;UC Sampdoria;Sassuolo Calcio;0;2;6;Serie A - Salvezza;2022/2023
30.04.23;Parma Calcio 1913;Pomigliano CF;2;2;6;Serie A - Salvezza;2022/2023
06.05.23;Sassuolo Calcio;Parma Calcio 1918;5;4;7;Serie A - Salvezza;2022/2023
07.05.23;FC Como Women;UC Sampdoria;2;1;7;Serie A - Salvezza;2022/2023
13.05.23;Pomigliano CF;Sassuolo Calcio;1;2;8;Serie A - Salvezza;2022/2023
14.05.23;Parma Calcio 1913;FC Como Women;2;2;8;Serie A - Salvezza;2022/2023
20.05.23;UC Sampdoria;Parma Calcio 1918;3;0;9;Serie A - Salvezza;2022/2023
20.05.23;FC Como Women;Pomigliano CF;0;1;9;Serie A - Salvezza;2022/2023
27.05.23;Sassuolo Calcio;FC Como Women;2;1;10;Serie A - Salvezza;2022/2023
27.05.23;Pomigliano CF;UC Sampdoria;2;4;10;Serie A - Salvezza;2022/2023
17.03.23;ACF Fiorentina;AS Roma;1;5;1;Serie A - Scudetto;2022/2023
18.03.23;Juventus;AC Milan;2;0;1;Serie A - Scudetto;2022/2023
25.03.23;Inter;Juventus;1;3;2;Serie A - Scudetto;2022/2023
26.03.23;AC Milan;ACF Fiorentina;3;3;2;Serie A - Scudetto;2022/2023
01.04.23;AS Roma;AC Milan;3;1;3;Serie A - Scudetto;2022/2023
02.04.23;ACF Fiorentina;Inter;1;0;3;Serie A - Scudetto;2022/2023
15.04.23;Inter;AS Roma;1;6;4;Serie A - Scudetto;2022/2023
16.04.23;Juventus;ACF Fiorentina;4;3;4;Serie A - Scudetto;2022/2023
22.04.23;AC Milan;Inter;3;1;5;Serie A - Scudetto;2022/2023
22.04.23;AS Roma;Juventus;3;2;5;Serie A - Scudetto;2022/2023
29.04.23;AS Roma;ACF Fiorentina;2;1;6;Serie A - Scudetto;2022/2023
30.04.23;AC Milan;Juventus;3;3;6;Serie A - Scudetto;2022/2023
06.05.23;Juventus;Inter;2;2;7;Serie A - Scudetto;2022/2023
07.05.23;ACF Fiorentina;AC Milan;1;1;7;Serie A - Scudetto;2022/2023
13.05.23;Inter;ACF Fiorentina;4;0;8;Serie A - Scudetto;2022/2023
13.05.23;AC Milan;AS Roma;2;2;8;Serie A - Scudetto;2022/2023
20.05.23;AS Roma;Inter;2;1;9;Serie A - Scudetto;2022/2023
21.05.23;ACF Fiorentina;Juventus;4;2;9;Serie A - Scudetto;2022/2023
27.05.23;Inter;AC Milan;0;1;10;Serie A - Scudetto;2022/2023
27.05.23;Juventus;AS Roma;5;2;10;Serie A - Scudetto;2022/2023
16.09.23;Pomigliano CF;Juventus;2;3;1;Serie A;2023/2024
16.09.23;ACF Fiorentina;Sassuolo Calcio;2;1;1;Serie A;2023/2024
17.09.23;FC Como Women;Napoli Femminile;2;1;1;Serie A;2023/2024
17.09.23;AC Milan;AS Roma;2;4;1;Serie A;2023/2024
17.09.23;UC Sampdoria;Inter;0;2;1;Serie A;2023/2024
30.09.23;AS Roma;FC Como Women;4;1;2;Serie A;2023/2024
01.10.23;Napoli Femminile;AC Milan;0;1;2;Serie A;2023/2024
01.10.23;Sassuolo Calcio;Pomigliano CF;1;1;2;Serie A;2023/2024
01.10.23;Juventus;UC Sampdoria;4;1;2;Serie A;2023/2024
02.10.23;Inter;ACF Fiorentina;1;1;2;Serie A;2023/2024
07.10.23;UC Sampdoria;FC Como Women;1;2;3;Serie A;2023/2024
07.10.23;Pomigliano CF;AS Roma;0;5;3;Serie A;2023/2024
07.10.23;AC Milan;Juventus;0;1;3;Serie A;2023/2024
08.10.23;ACF Fiorentina;Napoli Femminile;2;0;3;Serie A;2023/2024
08.10.23;Sassuolo Calcio;Inter;1;2;3;Serie A;2023/2024
14.10.23;Napoli Femminile;UC Sampdoria;0;2;4;Serie A;2023/2024
14.10.23;FC Como Women;AC Milan;0;0;4;Serie A;2023/2024
15.10.23;Pomigliano CF;ACF Fiorentina;1;4;4;Serie A;2023/2024
15.10.23;AS Roma;Inter;2;0;4;Serie A;2023/2024
15.10.23;Juventus;Sassuolo Calcio;4;0;4;Serie A;2023/2024
21.10.23;Inter;Napoli Femminile;2;0;5;Serie A;2023/2024
21.10.23;Sassuolo Calcio;FC Como Women;1;2;5;Serie A;2023/2024
22.10.23;AC Milan;Pomigliano CF;4;1;5;Serie A;2023/2024
22.10.23;ACF Fiorentina;Juventus;1;2;5;Serie A;2023/2024
22.10.23;UC Sampdoria;AS Roma;0;5;5;Serie A;2023/2024
04.11.23;Pomigliano CF;UC Sampdoria;0;1;6;Serie A;2023/2024
04.11.23;ACF Fiorentina;AC Milan;1;0;6;Serie A;2023/2024
05.11.23;Juventus;AS Roma;1;3;6;Serie A;2023/2024
05.11.23;Napoli Femminile;Sassuolo Calcio;0;1;6;Serie A;2023/2024
05.11.23;FC Como Women;Inter;2;1;6;Serie A;2023/2024
11.11.23;AS Roma;Napoli Femminile;6;0;7;Serie A;2023/2024
11.11.23;AC Milan;Sassuolo Calcio;1;1;7;Serie A;2023/2024
12.11.23;UC Sampdoria;ACF Fiorentina;0;1;7;Serie A;2023/2024
12.11.23;Inter;Pomigliano CF;2;1;7;Serie A;2023/2024
12.11.23;FC Como Women;Juventus;0;3;7;Serie A;2023/2024
18.11.23;ACF Fiorentina;FC Como Women;3;0;8;Serie A;2023/2024
18.11.23;AC Milan;UC Sampdoria;1;1;8;Serie A;2023/2024
19.11.23;Sassuolo Calcio;AS Roma;0;2;8;Serie A;2023/2024
19.11.23;Juventus;Inter;5;0;8;Serie A;2023/2024
19.11.23;Pomigliano CF;Napoli Femminile;2;1;8;Serie A;2023/2024
25.11.23;FC Como Women;Pomigliano CF;0;0;9;Serie A;2023/2024
25.11.23;Inter;AC Milan;1;0;9;Serie A;2023/2024
26.11.23;AS Roma;ACF Fiorentina;2;1;9;Serie A;2023/2024
26.11.23;Napoli Femminile;Juventus;1;3;9;Serie A;2023/2024
26.11.23;UC Sampdoria;Sassuolo Calcio;0;4;9;Serie A;2023/2024
09.12.23;Inter;UC Sampdoria;1;1;10;Serie A;2023/2024
09.12.23;Juventus;Pomigliano CF;4;0;10;Serie A;2023/2024
10.12.23;AS Roma;AC Milan;0;0;10;Serie A;2023/2024
10.12.23;Napoli Femminile;FC Como Women;0;0;10;Serie A;2023/2024
11.12.23;Sassuolo Calcio;ACF Fiorentina;1;2;10;Serie A;2023/2024
16.12.23;AC Milan;Napoli Femminile;1;1;11;Serie A;2023/2024
16.12.23;UC Sampdoria;Juventus;1;0;11;Serie A;2023/2024
17.12.23;Pomigliano CF;Sassuolo Calcio;0;2;11;Serie A;2023/2024
17.12.23;FC Como Women;AS Roma;2;3;11;Serie A;2023/2024
18.12.23;ACF Fiorentina;Inter;4;2;11;Serie A;2023/2024
13.01.24;Napoli Femminile;ACF Fiorentina;2;4;12;Serie A;2023/2024
13.01.24;Juventus;AC Milan;2;1;12;Serie A;2023/2024
13.01.24;AS Roma;Pomigliano CF;3;0;12;Serie A;2023/2024
14.01.24;Inter;Sassuolo Calcio;0;1;12;Serie A;2023/2024
14.01.24;FC Como Women;UC Sampdoria;0;1;12;Serie A;2023/2024
20.01.24;UC Sampdoria;Napoli Femminile;0;0;13;Serie A;2023/2024
20.01.24;Inter;AS Roma;2;0;13;Serie A;2023/2024
21.01.24;ACF Fiorentina;Pomigliano CF;3;1;13;Serie A;2023/2024
21.01.24;Sassuolo Calcio;Juventus;0;1;13;Serie A;2023/2024
22.01.24;AC Milan;FC Como Women;3;2;13;Serie A;2023/2024
27.01.24;Napoli Femminile;Inter;2;3;14;Serie A;2023/2024
27.01.24;AS Roma;UC Sampdoria;2;0;14;Serie A;2023/2024
28.01.24;Pomigliano CF;AC Milan;0;0;14;Serie A;2023/2024
28.01.24;FC Como Women;Sassuolo Calcio;0;1;14;Serie A;2023/2024
29.01.24;Juventus;ACF Fiorentina;2;2;14;Serie A;2023/2024
03.02.24;Sassuolo Calcio;Napoli Femminile;2;0;15;Serie A;2023/2024
03.02.24;AC Milan;ACF Fiorentina;2;2;15;Serie A;2023/2024
03.02.24;Inter;FC Como Women;2;3;15;Serie A;2023/2024
04.02.24;UC Sampdoria;Pomigliano CF;1;0;15;Serie A;2023/2024
04.02.24;AS Roma;Juventus;3;1;15;Serie A;2023/2024
10.02.24;Napoli Femminile;AS Roma;0;1;16;Serie A;2023/2024
10.02.24;Sassuolo Calcio;AC Milan;1;0;16;Serie A;2023/2024
11.02.24;Pomigliano CF;Inter;2;6;16;Serie A;2023/2024
11.02.24;ACF Fiorentina;UC Sampdoria;2;1;16;Serie A;2023/2024
11.02.24;Juventus;FC Como Women;5;0;16;Serie A;2023/2024
13.02.24;AS Roma;Sassuolo Calcio;3;0;17;Serie A;2023/2024
14.02.24;FC Como Women;ACF Fiorentina;0;1;17;Serie A;2023/2024
14.02.24;UC Sampdoria;AC Milan;1;3;17;Serie A;2023/2024
14.02.24;Inter;Juventus;0;2;17;Serie A;2023/2024
15.02.24;Napoli Femminile;Pomigliano CF;2;0;17;Serie A;2023/2024
17.02.24;Sassuolo Calcio;UC Sampdoria;2;0;18;Serie A;2023/2024
17.02.24;ACF Fiorentina;AS Roma;0;1;18;Serie A;2023/2024
18.02.24;Juventus;Napoli Femminile;4;1;18;Serie A;2023/2024
18.02.24;Pomigliano CF;FC Como Women;3;4;18;Serie A;2023/2024
18.02.24;AC Milan;Inter;2;1;18;Serie A;2023/2024
16.03.24;Pomigliano CF;UC Sampdoria;0;5;1;Serie A - Salvezza;2023/2024
17.03.24;FC Como Women;Napoli Femminile;1;1;1;Serie A - Salvezza;2023/2024
23.03.24;UC Sampdoria;FC Como Women;1;0;2;Serie A - Salvezza;2023/2024
24.03.24;AC Milan;Pomigliano CF;4;0;2;Serie A - Salvezza;2023/2024
30.03.24;Napoli Femminile;UC Sampdoria;2;0;3;Serie A - Salvezza;2023/2024
30.03.24;FC Como Women;AC Milan;1;4;3;Serie A - Salvezza;2023/2024
14.04.24;Pomigliano CF;FC Como Women;1;2;4;Serie A - Salvezza;2023/2024
14.04.24;AC Milan;Napoli Femminile;3;2;4;Serie A - Salvezza;2023/2024
21.04.24;UC Sampdoria;AC Milan;1;3;5;Serie A - Salvezza;2023/2024
21.04.24;Napoli Femminile;Pomigliano CF;1;1;5;Serie A - Salvezza;2023/2024
27.04.24;UC Sampdoria;Pomigliano CF;2;2;6;Serie A - Salvezza;2023/2024
27.04.24;Napoli Femminile;FC Como Women;1;1;6;Serie A - Salvezza;2023/2024
01.05.24;Pomigliano CF;AC Milan;2;2;7;Serie A - Salvezza;2023/2024
01.05.24;FC Como Women;UC Sampdoria;3;1;7;Serie A - Salvezza;2023/2024
05.05.24;UC Sampdoria;Napoli Femminile;2;0;8;Serie A - Salvezza;2023/2024
05.05.24;AC Milan;FC Como Women;1;0;8;Serie A - Salvezza;2023/2024
12.05.24;Napoli Femminile;AC Milan;1;1;9;Serie A - Salvezza;2023/2024
12.05.24;FC Como Women;Pomigliano CF;2;0;9;Serie A - Salvezza;2023/2024
18.05.24;AC Milan;UC Sampdoria;3;1;10;Serie A - Salvezza;2023/2024
19.05.24;Pomigliano CF;Napoli Femminile;3;1;10;Serie A - Salvezza;2023/2024
16.03.24;Sassuolo Calcio;ACF Fiorentina;1;0;1;Serie A - Scudetto;2023/2024
17.03.24;Inter;Juventus;3;3;1;Serie A - Scudetto;2023/2024
23.03.24;AS Roma;Sassuolo Calcio;3;0;2;Serie A - Scudetto;2023/2024
24.03.24;ACF Fiorentina;Inter;0;3;2;Serie A - Scudetto;2023/2024
29.03.24;Inter;AS Roma;1;2;3;Serie A - Scudetto;2023/2024
30.03.24;Juventus;ACF Fiorentina;4;0;3;Serie A - Scudetto;2023/2024
13.04.24;Sassuolo Calcio;Inter;2;1;4;Serie A - Scudetto;2023/2024
15.04.24;AS Roma;Juventus;2;1;4;Serie A - Scudetto;2023/2024
20.04.24;Juventus;Sassuolo Calcio;2;1;5;Serie A - Scudetto;2023/2024
20.04.24;ACF Fiorentina;AS Roma;0;0;5;Serie A - Scudetto;2023/2024
26.04.24;Juventus;Inter;0;2;6;Serie A - Scudetto;2023/2024
27.04.24;ACF Fiorentina;Sassuolo Calcio;4;4;6;Serie A - Scudetto;2023/2024
01.05.24;Inter;ACF Fiorentina;2;2;7;Serie A - Scudetto;2023/2024
01.05.24;Sassuolo Calcio;AS Roma;5;6;7;Serie A - Scudetto;2023/2024
05.05.24;AS Roma;Inter;4;3;8;Serie A - Scudetto;2023/2024
06.05.24;ACF Fiorentina;Juventus;0;2;8;Serie A - Scudetto;2023/2024
12.05.24;Inter;Sassuolo Calcio;2;4;9;Serie A - Scudetto;2023/2024
13.05.24;Juventus;AS Roma;3;1;9;Serie A - Scudetto;2023/2024
18.05.24;Sassuolo Calcio;Juventus;2;3;10;Serie A - Scudetto;2023/2024
19.05.24;AS Roma;ACF Fiorentina;5;0;10;Serie A - Scudetto;2023/2024
30.08.24;ACF Fiorentina;Napoli Femminile;1;0;1;Serie A;2024/2025
30.08.24;Lazio Roma;AS Roma;2;2;1;Serie A;2024/2025
31.08.24;Inter;UC Sampdoria;5;0;1;Serie A;2024/2025
01.09.24;Sassuolo Calcio;Juventus;3;6;1;Serie A;2024/2025
01.09.24;FC Como Women;AC Milan;1;0;1;Serie A;2024/2025
14.09.24;AS Roma;Sassuolo Calcio;1;1;2;Serie A;2024/2025
14.09.24;Juventus;FC Como Women;4;2;2;Serie A;2024/2025
14.09.24;AC Milan;ACF Fiorentina;1;2;2;Serie A;2024/2025
15.09.24;UC Sampdoria;Lazio Roma;1;1;2;Serie A;2024/2025
15.09.24;Napoli Femminile;Inter;1;4;2;Serie A;2024/2025
20.09.24;Napoli Femminile;Sassuolo Calcio;1;0;3;Serie A;2024/2025
21.09.24;Lazio Roma;Juventus;1;2;3;Serie A;2024/2025
15.09.24;FC Como Women;AS Roma;1;3;3;Serie A;2024/2025
15.09.24;Inter;AC Milan;1;1;3;Serie A;2024/2025
15.09.24;ACF Fiorentina;UC Sampdoria;4;0;3;Serie A;2024/2025
28.09.24;FC Como Women;UC Sampdoria;1;1;4;Serie A;2024/2025
28.09.24;Sassuolo Calcio;Inter;1;3;4;Serie A;2024/2025
29.09.24;AS Roma;Napoli Femminile;3;1;4;Serie A;2024/2025
29.09.24;AC Milan;Lazio Roma;2;1;4;Serie A;2024/2025
30.09.24;Juventus;ACF Fiorentina;4;0;4;Serie A;2024/2025
05.10.24;ACF Fiorentina;FC Como Women;3;1;5;Serie A;2024/2025
05.10.24;Inter;AS Roma;1;1;5;Serie A;2024/2025
05.10.24;UC Sampdoria;Juventus;0;2;5;Serie A;2024/2025
06.10.24;Lazio Roma;Sassuolo Calcio;3;2;5;Serie A;2024/2025
06.10.24;Napoli Femminile;AC Milan;0;1;5;Serie A;2024/2025
12.10.24;Sassuolo Calcio;ACF Fiorentina;1;3;6;Serie A;2024/2025
12.10.24;FC Como Women;Inter;0;1;6;Serie A;2024/2025
13.10.24;AC Milan;UC Sampdoria;1;0;6;Serie A;2024/2025
13.10.24;Juventus;AS Roma;2;1;6;Serie A;2024/2025
13.10.24;Lazio Roma;Napoli Femminile;0;0;6;Serie A;2024/2025
19.10.24;UC Sampdoria;Napoli Femminile;0;0;7;Serie A;2024/2025
19.10.24;ACF Fiorentina;Lazio Roma;3;2;7;Serie A;2024/2025
20.10.24;Inter;Juventus;0;0;7;Serie A;2024/2025
20.10.24;AS Roma;AC Milan;2;1;7;Serie A;2024/2025
20.10.24;Sassuolo Calcio;FC Como Women;2;4;7;Serie A;2024/2025
02.11.24;Lazio Roma;FC Como Women;1;2;8;Serie A;2024/2025
03.11.24;ACF Fiorentina;Inter;2;1;8;Serie A;2024/2025
03.11.24;Napoli Femminile;Juventus;0;3;8;Serie A;2024/2025
03.11.24;UC Sampdoria;AS Roma;1;5;8;Serie A;2024/2025
03.11.24;AC Milan;Sassuolo Calcio;1;0;8;Serie A;2024/2025
09.11.24;AS Roma;ACF Fiorentina;1;0;9;Serie A;2024/2025
09.11.24;Juventus;AC Milan;3;0;9;Serie A;2024/2025
09.11.24;Sassuolo Calcio;UC Sampdoria;3;0;9;Serie A;2024/2025
10.11.24;FC Como Women;Napoli Femminile;3;0;9;Serie A;2024/2025
10.11.24;Inter;Lazio Roma;1;0;9;Serie A;2024/2025
16.11.24;Napoli Femminile;ACF Fiorentina;0;0;10;Serie A;2024/2025
16.11.24;UC Sampdoria;Inter;0;3;10;Serie A;2024/2025
17.11.24;Juventus;Sassuolo Calcio;2;2;10;Serie A;2024/2025
17.11.24;AS Roma;Lazio Roma;2;1;10;Serie A;2024/2025
17.11.24;AC Milan;FC Como Women;0;1;10;Serie A;2024/2025
23.11.24;Lazio Roma;UC Sampdoria;0;0;11;Serie A;2024/2025
23.11.24;Inter;Napoli Femminile;1;0;11;Serie A;2024/2025
24.11.24;ACF Fiorentina;AC Milan;2;2;11;Serie A;2024/2025
24.11.24;Sassuolo Calcio;AS Roma;1;1;11;Serie A;2024/2025
24.11.24;FC Como Women;Juventus;1;4;11;Serie A;2024/2025
06.12.25;AS Roma;FC Como Women;2;1;12;Serie A;2024/2025
07.12.24;Sassuolo Calcio;Napoli Femminile;2;1;12;Serie A;2024/2025
07.12.24;UC Sampdoria;ACF Fiorentina;1;3;12;Serie A;2024/2025
08.12.24;Juventus;Lazio Roma;3;2;12;Serie A;2024/2025
08.12.24;AC Milan;Inter;1;1;12;Serie A;2024/2025
14.12.24;Lazio Roma;AC Milan;2;0;13;Serie A;2024/2025
14.12.24;Napoli Femminile;AS Roma;1;2;13;Serie A;2024/2025
15.12.24;UC Sampdoria;FC Como Women;1;2;13;Serie A;2024/2025
15.12.24;Inter;Sassuolo Calcio;3;0;13;Serie A;2024/2025
15.12.24;ACF Fiorentina;Juventus;0;3;13;Serie A;2024/2025
11.01.25;Juventus;UC Sampdoria;3;0;14;Serie A;2024/2025
11.01.25;FC Como Women;ACF Fiorentina;2;0;14;Serie A;2024/2025
11.01.25;Sassuolo Calcio;Lazio Roma;3;1;14;Serie A;2024/2025
12.01.25;AC Milan;Napoli Femminile;6;0;14;Serie A;2024/2025
12.01.25;AS Roma;Inter;1;2;14;Serie A;2024/2025
18.01.25;Napoli Femminile;Lazio Roma;0;4;15;Serie A;2024/2025
19.01.25;Inter;FC Como Women;1;0;15;Serie A;2024/2025
19.01.25;UC Sampdoria;AC Milan;2;2;15;Serie A;2024/2025
19.01.25;AS Roma;Juventus;3;1;15;Serie A;2024/2025
19.01.25;ACF Fiorentina;Sassuolo Calcio;1;1;15;Serie A;2024/2025
24.01.25;Juventus;Inter;2;0;16;Serie A;2024/2025
25.01.25;Lazio Roma;ACF Fiorentina;2;0;16;Serie A;2024/2025
25.01.25;FC Como Women;Sassuolo Calcio;0;3;16;Serie A;2024/2025
25.01.25;AC Milan;AS Roma;3;2;16;Serie A;2024/2025
26.01.25;Napoli Femminile;UC Sampdoria;0;1;16;Serie A;2024/2025
01.02.25;Inter;ACF Fiorentina;2;0;17;Serie A;2024/2025
01.02.25;AS Roma;UC Sampdoria;4;0;17;Serie A;2024/2025
01.02.25;Sassuolo Calcio;AC Milan;2;3;17;Serie A;2024/2025
02.02.25;Juventus;Napoli Femminile;1;1;17;Serie A;2024/2025
02.02.25;FC Como Women;Lazio Roma;1;2;17;Serie A;2024/2025
09.02.25;Lazio Roma;Inter;4;4;18;Serie A;2024/2025
09.02.25;UC Sampdoria;Sassuolo Calcio;0;2;18;Serie A;2024/2025
09.02.25;Napoli Femminile;FC Como Women;4;2;18;Serie A;2024/2025
09.02.25;AC Milan;Juventus;0;6;18;Serie A;2024/2025
09.02.25;ACF Fiorentina;AS Roma;0;0;18;Serie A;2024/2025
01.03.25;Lazio Roma;UC Sampdoria;3;0;1;Serie A - Salvezza;2024/2025
02.03.25;Sassuolo Calcio;Napoli Femminile;3;1;1;Serie A - Salvezza;2024/2025
08.03.25;Napoli Femminile;Lazio Roma;0;4;2;Serie A - Salvezza;2024/2025
10.03.25;FC Como Women;Sassuolo Calcio;3;0;2;Serie A - Salvezza;2024/2025
15.03.25;UC Sampdoria;Napoli Femminile;0;0;3;Serie A - Salvezza;2024/2025
16.03.25;Lazio Roma;FC Como Women;0;2;3;Serie A - Salvezza;2024/2025
22.03.25;Sassuolo Calcio;Lazio Roma;0;2;4;Serie A - Salvezza;2024/2025
23.03.25;FC Como Women;UC Sampdoria;2;2;4;Serie A - Salvezza;2024/2025
30.03.25;Napoli Femminile;FC Como Women;0;2;5;Serie A - Salvezza;2024/2025
30.03.25;UC Sampdoria;Sassuolo Calcio;2;5;5;Serie A - Salvezza;2024/2025
12.04.25;UC Sampdoria;Lazio Roma;0;3;6;Serie A - Salvezza;2024/2025
13.04.25;Napoli Femminile;Sassuolo Calcio;0;1;6;Serie A - Salvezza;2024/2025
18.04.25;Lazio Roma;Napoli Femminile;2;1;7;Serie A - Salvezza;2024/2025
19.04.25;Sassuolo Calcio;FC Como Women;3;0;7;Serie A - Salvezza;2024/2025
27.04.25;FC Como Women;Lazio Roma;0;4;8;Serie A - Salvezza;2024/2025
27.04.25;Napoli Femminile;UC Sampdoria;2;1;8;Serie A - Salvezza;2024/2025
03.05.25;Lazio Roma;Sassuolo Calcio;5;0;9;Serie A - Salvezza;2024/2025
03.05.25;UC Sampdoria;FC Como Women;1;2;9;Serie A - Salvezza;2024/2025
11.05.25;FC Como Women;Napoli Femminile;3;1;10;Serie A - Salvezza;2024/2025
11.05.25;Sassuolo Calcio;UC Sampdoria;4;2;10;Serie A - Salvezza;2024/2025
02.03.25;Juventus;AS Roma;4;3;1;Serie A - Scudetto;2024/2025
02.03.25;ACF Fiorentina;AC Milan;0;0;1;Serie A - Scudetto;2024/2025
09.03.25;AS Roma;Inter;2;1;2;Serie A - Scudetto;2024/2025
09.03.25;AC Milan;Juventus;2;2;2;Serie A - Scudetto;2024/2025
15.03.25;Juventus;ACF Fiorentina;0;2;3;Serie A - Scudetto;2024/2025
16.03.25;Inter;AC Milan;3;3;3;Serie A - Scudetto;2024/2025
22.03.25;AC Milan;AS Roma;3;1;4;Serie A - Scudetto;2024/2025
23.03.25;ACF Fiorentina;Inter;1;0;4;Serie A - Scudetto;2024/2025
29.03.25;AS Roma;ACF Fiorentina;2;0;5;Serie A - Scudetto;2024/2025
30.03.25;Inter;Juventus;3;2;5;Serie A - Scudetto;2024/2025
12.04.25;AC Milan;ACF Fiorentina;5;3;6;Serie A - Scudetto;2024/2025
13.04.25;AS Roma;Juventus;1;2;6;Serie A - Scudetto;2024/2025
18.04.25;Juventus;AC Milan;2;0;7;Serie A - Scudetto;2024/2025
19.04.25;Inter;AS Roma;3;0;7;Serie A - Scudetto;2024/2025
25.04.25;ACF Fiorentina;Juventus;3;1;8;Serie A - Scudetto;2024/2025
25.04.25;AC Milan;Inter;1;4;8;Serie A - Scudetto;2024/2025
03.05.25;Inter;ACF Fiorentina;1;3;9;Serie A - Scudetto;2024/2025
04.05.25;AS Roma;AC Milan;3;3;9;Serie A - Scudetto;2024/2025
10.05.25;ACF Fiorentina;AS Roma;0;1;10;Serie A - Scudetto;2024/2025
10.05.25;Juventus;Inter;0;1;10;Serie A - Scudetto;2024/2025
04.10.25;Inter;Ternana Calcio;5;0;1;Serie A;2025/2026
04.10.25;AS Roma;Parma Calcio 1913;4;0;1;Serie A;2025/2026
04.10.25;Napoli Women;ACF Fiorentina;1;0;1;Serie A;2025/2026
04.10.25;Sassuolo Calcio;Juventus;0;0;1;Serie A;2025/2026
05.10.25;FC Como Women;Lazio Roma;1;2;1;Serie A;2025/2026
05.10.25;Genoa CFC;AC Milan;1;2;1;Serie A;2025/2026
11.10.25;Lazio Roma;Genoa CFC;2;1;2;Serie A;2025/2026
11.10.25;Juventus;FC Como Women;0;1;2;Serie A;2025/2026
11.10.25;ACF Fiorentina;Inter;2;2;2;Serie A;2025/2026
12.10.25;AC Milan;AS Roma;1;2;2;Serie A;2025/2026
12.10.25;Ternana Calcio;Napoli Women;3;4;2;Serie A;2025/2026
12.10.25;Parma Calcio 1913;Sassuolo Calcio;2;1;2;Serie A;2025/2026
18.10.25;Sassuolo Calcio;FC Como Women;1;0;3;Serie A;2025/2026
18.10.25;Genoa CFC;Ternana Calcio;3;1;3;Serie A;2025/2026
18.10.25;ACF Fiorentina;AC Milan;4;3;3;Serie A;2025/2026
19.10.25;Napoli Women;AS Roma;1;3;3;Serie A;2025/2026
19.10.25;Lazio Roma;Juventus;0;1;3;Serie A;2025/2026
19.10.25;Inter;Parma Calcio 1913;0;0;3;Serie A;2025/2026
01.11.25;Parma Calcio 1913;Napoli Women;1;1;4;Serie A;2025/2026
01.11.25;AC Milan;Lazio Roma;4;2;4;Serie A;2025/2026
01.11.25;FC Como Women;Genoa CFC;2;1;4;Serie A;2025/2026
02.11.25;AS Roma;Inter;3;0;4;Serie A;2025/2026
02.11.25;Juventus;Ternana Calcio;2;1;4;Serie A;2025/2026
02.11.25;Sassuolo Calcio;ACF Fiorentina;0;1;4;Serie A;2025/2026
07.11.25;ACF Fiorentina;AS Roma;5;2;5;Serie A;2025/2026
08.11.25;Inter;Sassuolo Calcio;2;2;5;Serie A;2025/2026
08.11.25;AC Milan;Juventus;2;1;5;Serie A;2025/2026
09.11.25;Ternana Calcio;FC Como Women;2;4;5;Serie A;2025/2026
09.11.25;Lazio Roma;Napoli Women;1;0;5;Serie A;2025/2026
09.11.25;Genoa CFC;Parma Calcio 1913;1;0;5;Serie A;2025/2026
15.11.25;Sassuolo Calcio;Ternana Calcio;0;1;6;Serie A;2025/2026
15.11.25;Parma Calcio 1913;ACF Fiorentina;1;1;6;Serie A;2025/2026
15.11.25;FC Como Women;AC Milan;1;0;6;Serie A;2025/2026
16.11.25;Napoli Women;Inter;1;0;6;Serie A;2025/2026
16.11.25;AS Roma;Lazio Roma;1;0;6;Serie A;2025/2026
16.11.25;Juventus;Genoa CFC;2;0;6;Serie A;2025/2026
22.11.25;Genoa CFC;Napoli Women;1;3;7;Serie A;2025/2026
22.11.25;Ternana Calcio;Parma Calcio 1913;0;0;7;Serie A;2025/2026
23.11.25;FC Como Women;AS Roma;0;1;7;Serie A;2025/2026
23.11.25;Lazio Roma;Inter;0;2;7;Serie A;2025/2026
23.11.25;Juventus;ACF Fiorentina;1;0;7;Serie A;2025/2026
23.11.25;AC Milan;Sassuolo Calcio;2;2;7;Serie A;2025/2026
06.12.25;Napoli Women;AC Milan;0;2;8;Serie A;2025/2026
06.12.25;AS Roma;Juventus;1;1;8;Serie A;2025/2026
07.12.25;Inter;Genoa CFC;5;0;8;Serie A;2025/2026
07.12.25;ACF Fiorentina;Ternana Calcio;1;0;8;Serie A;2025/2026
07.12.25;Parma Calcio 1913;FC Como Women;0;1;8;Serie A;2025/2026
08.12.25;Sassuolo Calcio;Lazio Roma;1;2;8;Serie A;2025/2026
13.12.25;FC Como Women;ACF Fiorentina;1;3;9;Serie A;2025/2026
13.12.25;Juventus;Napoli Women;2;1;9;Serie A;2025/2026
13.12.25;AC Milan;Inter;1;5;9;Serie A;2025/2026
13.12.25;Ternana Calcio;AS Roma;0;2;9;Serie A;2025/2026
14.12.25;Genoa CFC;Sassuolo Calcio;0;1;9;Serie A;2025/2026
14.12.25;Lazio Roma;Parma Calcio 1913;1;0;9;Serie A;2025/2026
17.01.26;Parma Calcio 1913;AC Milan;0;0;10;Serie A;2025/2026
17.01.26;ACF Fiorentina;Genoa CFC;1;1;10;Serie A;2025/2026
17.01.26;Napoli Women;FC Como Women;0;0;10;Serie A;2025/2026
18.01.26;AS Roma;Sassuolo Calcio;2;1;10;Serie A;2025/2026
18.01.26;Ternana Calcio;Lazio Roma;1;0;10;Serie A;2025/2026
18.01.26;Inter;Juventus;2;1;10;Serie A;2025/2026
24.01.26;Lazio Roma;ACF Fiorentina;3;0;11;Serie A;2025/2026
25.01.26;AC Milan;Ternana Calcio;3;0;11;Serie A;2025/2026
25.01.26;Genoa CFC;AS Roma;0;1;11;Serie A;2025/2026
25.01.26;FC Como Women;Inter;2;3;11;Serie A;2025/2026
25.01.26;Sassuolo Calcio;Napoli Women;0;2;11;Serie A;2025/2026
26.01.26;Juventus;Parma Calcio 1913;3;0;11;Serie A;2025/2026
01.02.26;Lazio Roma;FC Como Women;1;1;12;Serie A;2025/2026
01.02.26;AC Milan;Genoa CFC;2;1;12;Serie A;2025/2026
01.02.26;Ternana Calcio;Inter;0;1;12;Serie A;2025/2026
01.02.26;Parma Calcio 1913;AS Roma;3;3;12;Serie A;2025/2026
01.02.26;Juventus;Sassuolo Calcio;4;0;12;Serie A;2025/2026
02.02.26;ACF Fiorentina;Napoli Women;1;2;12;Serie A;2025/2026
07.02.26;Sassuolo Calcio;Parma Calcio 1913;1;0;13;Serie A;2025/2026
07.02.26;Genoa CFC;Lazio Roma;2;5;13;Serie A;2025/2026
07.02.26;FC Como Women;Juventus;0;2;13;Serie A;2025/2026
08.02.26;AS Roma;AC Milan;1;0;13;Serie A;2025/2026
08.02.26;Napoli Women;Ternana Calcio;3;1;13;Serie A;2025/2026
08.02.26;Inter;ACF Fiorentina;3;0;13;Serie A;2025/2026
14.02.26;FC Como Women;Sassuolo Calcio;2;0;14;Serie A;2025/2026
14.02.26;Ternana Calcio;Genoa CFC;3;1;14;Serie A;2025/2026
14.02.26;AC Milan;ACF Fiorentina;0;1;14;Serie A;2025/2026
15.02.26;Parma Calcio 1913;Inter;2;3;14;Serie A;2025/2026
15.02.26;Juventus;Lazio Roma;0;0;14;Serie A;2025/2026
15.02.26;AS Roma;Napoli Women;2;2;14;Serie A;2025/2026
21.02.26;Napoli Women;Parma Calcio 1913;0;0;15;Serie A;2025/2026
21.02.26;Genoa CFC;FC Como Women;0;1;15;Serie A;2025/2026
21.02.26;Lazio Roma;AC Milan;2;2;15;Serie A;2025/2026
22.02.26;Ternana Calcio;Juventus;2;2;15;Serie A;2025/2026
22.02.26;Inter;AS Roma;0;1;15;Serie A;2025/2026
22.02.26;ACF Fiorentina;Sassuolo Calcio;3;2;15;Serie A;2025/2026
14.03.26;Parma Calcio 1913;Genoa CFC;1;1;16;Serie A;2025/2026
14.03.26;Napoli Women;Lazio Roma;0;1;16;Serie A;2025/2026
15.03.26;FC Como Women;Ternana Calcio;0;0;16;Serie A;2025/2026
15.03.26;Juventus;AC Milan;0;1;16;Serie A;2025/2026
15.03.26;AS Roma;ACF Fiorentina;1;1;16;Serie A;2025/2026
16.03.26;Sassuolo Calcio;Inter;0;3;16;Serie A;2025/2026
21.03.26;Genoa CFC;Juventus;0;0;17;Serie A;2025/2026
21.03.26;Inter;Napoli Women;2;2;17;Serie A;2025/2026
21.03.26;Lazio Roma;AS Roma;1;2;17;Serie A;2025/2026
22.03.26;ACF Fiorentina;Parma Calcio 1913;0;0;17;Serie A;2025/2026
22.03.26;Ternana Calcio;Sassuolo Calcio;1;1;17;Serie A;2025/2026
22.03.26;AC Milan;FC Como Women;0;0;17;Serie A;2025/2026
03.04.26;AS Roma;FC Como Women;4;3;18;Serie A;2025/2026
03.04.26;Sassuolo Calcio;AC Milan;0;3;18;Serie A;2025/2026
04.04.26;ACF Fiorentina;Juventus;1;2;18;Serie A;2025/2026
04.04.26;Napoli Women;Genoa CFC;4;1;18;Serie A;2025/2026
04.04.26;Inter;Lazio Roma;5;2;18;Serie A;2025/2026
04.04.26;Parma Calcio 1913;Ternana Calcio;2;0;18;Serie A;2025/2026
25.04.26;FC Como Women;Parma Calcio 1913;1;1;19;Serie A;2025/2026
25.04.26;Juventus;AS Roma;0;1;19;Serie A;2025/2026
25.04.26;Lazio Roma;Sassuolo Calcio;0;3;19;Serie A;2025/2026
25.04.26;AC Milan;Napoli Women;0;0;19;Serie A;2025/2026
25.04.26;Genoa CFC;Inter;1;2;19;Serie A;2025/2026
26.04.26;Ternana Calcio;ACF Fiorentina;2;2;19;Serie A;2025/2026
02.05.26;Napoli Women;Juventus;2;3;20;Serie A;2025/2026
02.05.26;Sassuolo Calcio;Genoa CFC;0;0;20;Serie A;2025/2026
02.05.26;Inter;AC Milan;1;0;20;Serie A;2025/2026
02.05.26;AS Roma;Ternana Calcio;2;0;20;Serie A;2025/2026
03.05.26;Parma Calcio 1913;Lazio Roma;1;3;20;Serie A;2025/2026
03.05.26;ACF Fiorentina;FC Como Women;1;0;20;Serie A;2025/2026
09.05.26;FC Como Women;Napoli Women;0;0;21;Serie A;2025/2026
09.05.26;Genoa CFC;ACF Fiorentina;2;3;21;Serie A;2025/2026
10.05.26;AC Milan;Parma Calcio 1913;3;1;21;Serie A;2025/2026
10.05.26;Juventus;Inter;3;3;21;Serie A;2025/2026
10.05.26;Sassuolo Calcio;AS Roma;0;3;21;Serie A;2025/2026
10.05.26;Lazio Roma;Ternana Calcio;2;0;21;Serie A;2025/2026
16.05.26;Inter;FC Como Women;0;3;22;Serie A;2025/2026
17.05.26;Parma Calcio 1913;Juventus;1;3;22;Serie A;2025/2026
17.05.26;ACF Fiorentina;Lazio Roma;1;0;22;Serie A;2025/2026
17.05.26;Ternana Calcio;AC Milan;1;0;22;Serie A;2025/2026
17.05.26;Napoli Women;Sassuolo Calcio;1;1;22;Serie A;2025/2026
16.05.26;AS Roma;Genoa CFC;2;0;22;Serie A;2025/2026
27.08.21;Olympique Lyonnais;Stade de Reims;3;0;1;Division 1;2021/2022
28.08.21;AS Saint-Étienne;Girondins Bordeaux;1;1;1;Division 1;2021/2022
28.08.21;Dijon FCO;Montpellier HSC;1;2;1;Division 1;2021/2022
28.08.21;Paris FC;EA Guingamp;4;1;1;Division 1;2021/2022
28.08.21;ASJ Soyaux;GPSO 92 Issy;2;0;1;Division 1;2021/2022
29.08.21;Paris Saint-Germain;FC Fleury 91;5;0;1;Division 1;2021/2022
03.09.21;FC Fleury 91;Paris FC;0;1;2;Division 1;2021/2022
03.09.21;Montpellier HSC;Paris Saint-Germain;0;1;2;Division 1;2021/2022
04.09.21;Girondins Bordeaux;ASJ Soyaux;6;0;2;Division 1;2021/2022
04.09.21;GPSO 92 Issy;Dijon FCO;0;2;2;Division 1;2021/2022
04.09.21;Stade de Reims;EA Guingamp;0;0;2;Division 1;2021/2022
05.09.21;Olympique Lyonnais;AS Saint-Étienne;6;0;2;Division 1;2021/2022
10.09.21;EA Guingamp;Montpellier HSC;2;1;3;Division 1;2021/2022
11.09.21;AS Saint-Étienne;GPSO 92 Issy;0;1;3;Division 1;2021/2022
11.09.21;Paris FC;Stade de Reims;3;0;3;Division 1;2021/2022
12.09.21;Girondins Bordeaux;FC Fleury 91;1;2;3;Division 1;2021/2022
12.09.21;ASJ Soyaux;Paris Saint-Germain;0;2;3;Division 1;2021/2022
12.09.21;Olympique Lyonnais;Dijon FCO;6;0;3;Division 1;2021/2022
24.09.21;Olympique Lyonnais;EA Guingamp;4;0;4;Division 1;2021/2022
25.09.21;FC Fleury 91;ASJ Soyaux;1;0;4;Division 1;2021/2022
25.09.21;GPSO 92 Issy;Girondins Bordeaux;0;1;4;Division 1;2021/2022
25.09.21;Stade de Reims;Montpellier HSC;1;4;4;Division 1;2021/2022
25.09.21;Dijon FCO;AS Saint-Étienne;0;4;4;Division 1;2021/2022
26.09.21;Paris Saint-Germain;Paris FC;4;0;4;Division 1;2021/2022
01.10.21;Girondins Bordeaux;Olympique Lyonnais;1;4;5;Division 1;2021/2022
01.10.21;Montpellier HSC;FC Fleury 91;1;2;5;Division 1;2021/2022
02.10.21;AS Saint-Étienne;Paris FC;1;3;5;Division 1;2021/2022
02.10.21;GPSO 92 Issy;Stade de Reims;1;3;5;Division 1;2021/2022
02.10.21;ASJ Soyaux;Dijon FCO;1;2;5;Division 1;2021/2022
10.10.21;Paris Saint-Germain;EA Guingamp;6;0;5;Division 1;2021/2022
16.10.21;Stade de Reims;Girondins Bordeaux;5;2;6;Division 1;2021/2022
16.10.21;EA Guingamp;GPSO 92 Issy;1;1;6;Division 1;2021/2022
16.10.21;Paris FC;ASJ Soyaux;4;0;6;Division 1;2021/2022
16.10.21;FC Fleury 91;Dijon FCO;0;1;6;Division 1;2021/2022
17.10.21;Olympique Lyonnais;Montpellier HSC;5;0;6;Division 1;2021/2022
17.10.21;Paris Saint-Germain;AS Saint-Étienne;2;0;6;Division 1;2021/2022
30.10.21;GPSO 92 Issy;Paris FC;0;5;7;Division 1;2021/2022
30.10.21;AS Saint-Étienne;Montpellier HSC;1;2;7;Division 1;2021/2022
30.10.21;Girondins Bordeaux;EA Guingamp;3;0;7;Division 1;2021/2022
30.10.21;FC Fleury 91;Stade de Reims;1;0;7;Division 1;2021/2022
31.10.21;Dijon FCO;Paris Saint-Germain;0;3;7;Division 1;2021/2022
31.10.21;ASJ Soyaux;Olympique Lyonnais;1;6;7;Division 1;2021/2022
12.11.21;Paris FC;Girondins Bordeaux;1;3;8;Division 1;2021/2022
13.11.21;AS Saint-Étienne;FC Fleury 91;0;4;8;Division 1;2021/2022
13.11.21;EA Guingamp;ASJ Soyaux;2;2;8;Division 1;2021/2022
13.11.21;Montpellier HSC;GPSO 92 Issy;3;0;8;Division 1;2021/2022
13.11.21;Stade de Reims;Dijon FCO;1;1;8;Division 1;2021/2022
14.11.21;Olympique Lyonnais;Paris Saint-Germain;6;1;8;Division 1;2021/2022
20.11.21;Dijon FCO;Paris FC;0;2;9;Division 1;2021/2022
20.11.21;FC Fleury 91;EA Guingamp;6;2;9;Division 1;2021/2022
20.11.21;ASJ Soyaux;AS Saint-Étienne;2;1;9;Division 1;2021/2022
20.11.21;Girondins Bordeaux;Montpellier HSC;0;1;9;Division 1;2021/2022
21.11.21;GPSO 92 Issy;Olympique Lyonnais;0;4;9;Division 1;2021/2022
21.11.21;Paris Saint-Germain;Stade de Reims;7;0;9;Division 1;2021/2022
03.12.21;Montpellier HSC;Paris FC;0;0;10;Division 1;2021/2022
04.12.21;Stade de Reims;ASJ Soyaux;3;1;10;Division 1;2021/2022
04.12.21;EA Guingamp;AS Saint-Étienne;1;1;10;Division 1;2021/2022
04.12.21;Girondins Bordeaux;Dijon FCO;1;1;10;Division 1;2021/2022
04.12.21;GPSO 92 Issy;Paris Saint-Germain;0;3;10;Division 1;2021/2022
05.12.21;Olympique Lyonnais;FC Fleury 91;4;0;10;Division 1;2021/2022
12.12.21;AS Saint-Étienne;Stade de Reims;0;1;11;Division 1;2021/2022
12.12.21;Dijon FCO;EA Guingamp;1;1;11;Division 1;2021/2022
12.12.21;Paris FC;Olympique Lyonnais;1;2;11;Division 1;2021/2022
12.12.21;FC Fleury 91;GPSO 92 Issy;1;0;11;Division 1;2021/2022
12.12.21;Paris Saint-Germain;Girondins Bordeaux;1;0;11;Division 1;2021/2022
12.12.21;ASJ Soyaux;Montpellier HSC;0;1;11;Division 1;2021/2022
15.01.22;Paris FC;GPSO 92 Issy;1;0;12;Division 1;2021/2022
15.01.22;Montpellier HSC;AS Saint-Étienne;3;0;12;Division 1;2021/2022
15.01.22;Stade de Reims;FC Fleury 91;0;1;12;Division 1;2021/2022
29.01.22;EA Guingamp;Girondins Bordeaux;0;2;12;Division 1;2021/2022
11.02.22;Olympique Lyonnais;ASJ Soyaux;8;0;12;Division 1;2021/2022
11.02.22;Paris Saint-Germain;Dijon FCO;5;0;12;Division 1;2021/2022
22.01.22;Girondins Bordeaux;Stade de Reims;3;1;13;Division 1;2021/2022
22.01.22;GPSO 92 Issy;EA Guingamp;0;2;13;Division 1;2021/2022
22.01.22;ASJ Soyaux;Paris FC;1;3;13;Division 1;2021/2022
22.01.22;Montpellier HSC;Olympique Lyonnais;2;3;13;Division 1;2021/2022
23.01.22;AS Saint-Étienne;Paris Saint-Germain;0;5;13;Division 1;2021/2022
08.02.22;Dijon FCO;FC Fleury 91;0;0;13;Division 1;2021/2022
04.02.22;FC Fleury 91;Montpellier HSC;1;0;14;Division 1;2021/2022
05.02.22;EA Guingamp;Paris Saint-Germain;2;6;14;Division 1;2021/2022
05.02.22;Dijon FCO;ASJ Soyaux;0;1;14;Division 1;2021/2022
05.02.22;Paris FC;AS Saint-Étienne;2;1;14;Division 1;2021/2022
05.02.22;Stade de Reims;GPSO 92 Issy;4;3;14;Division 1;2021/2022
06.02.22;Olympique Lyonnais;Girondins Bordeaux;1;0;14;Division 1;2021/2022
26.02.22;EA Guingamp;Paris FC;2;5;15;Division 1;2021/2022
26.02.22;Girondins Bordeaux;AS Saint-Étienne;3;0;15;Division 1;2021/2022
26.02.22;GPSO 92 Issy;ASJ Soyaux;5;1;15;Division 1;2021/2022
26.02.22;Montpellier HSC;Dijon FCO;2;0;15;Division 1;2021/2022
27.02.22;FC Fleury 91;Paris Saint-Germain;0;4;15;Division 1;2021/2022
27.02.22;Stade de Reims;Olympique Lyonnais;0;2;15;Division 1;2021/2022
11.03.22;Paris FC;FC Fleury 91;3;1;16;Division 1;2021/2022
11.03.22;Paris Saint-Germain;Montpellier HSC;0;0;16;Division 1;2021/2022
12.03.22;AS Saint-Étienne;Olympique Lyonnais;1;1;16;Division 1;2021/2022
12.03.22;EA Guingamp;Stade de Reims;0;1;16;Division 1;2021/2022
12.03.22;ASJ Soyaux;Girondins Bordeaux;0;3;16;Division 1;2021/2022
12.03.22;Dijon FCO;GPSO 92 Issy;0;1;16;Division 1;2021/2022
18.03.22;Dijon FCO;Olympique Lyonnais;0;3;17;Division 1;2021/2022
18.03.22;Paris Saint-Germain;ASJ Soyaux;2;0;17;Division 1;2021/2022
19.03.22;Montpellier HSC;EA Guingamp;6;0;17;Division 1;2021/2022
19.03.22;GPSO 92 Issy;AS Saint-Étienne;4;1;17;Division 1;2021/2022
19.03.22;Stade de Reims;Paris FC;1;2;17;Division 1;2021/2022
20.03.22;FC Fleury 91;Girondins Bordeaux;2;0;17;Division 1;2021/2022
02.04.22;Montpellier HSC;Stade de Reims;1;2;18;Division 1;2021/2022
02.04.22;ASJ Soyaux;FC Fleury 91;0;1;18;Division 1;2021/2022
02.04.22;Girondins Bordeaux;GPSO 92 Issy;3;0;18;Division 1;2021/2022
03.04.22;EA Guingamp;Olympique Lyonnais;0;2;18;Division 1;2021/2022
03.04.22;Paris FC;Paris Saint-Germain;0;0;18;Division 1;2021/2022
23.04.22;AS Saint-Étienne;Dijon FCO;2;2;18;Division 1;2021/2022
15.04.22;Paris FC;Montpellier HSC;3;1;19;Division 1;2021/2022
16.04.22;AS Saint-Étienne;EA Guingamp;1;3;19;Division 1;2021/2022
16.04.22;Dijon FCO;Girondins Bordeaux;0;2;19;Division 1;2021/2022
16.04.22;ASJ Soyaux;Stade de Reims;1;2;19;Division 1;2021/2022
16.04.22;Paris Saint-Germain;GPSO 92 Issy;6;1;19;Division 1;2021/2022
17.04.22;FC Fleury 91;Olympique Lyonnais;1;2;19;Division 1;2021/2022
07.05.22;EA Guingamp;Dijon FCO;4;0;20;Division 1;2021/2022
07.05.22;Montpellier HSC;ASJ Soyaux;3;0;20;Division 1;2021/2022
07.05.22;GPSO 92 Issy;FC Fleury 91;0;5;20;Division 1;2021/2022
07.05.22;Stade de Reims;AS Saint-Étienne;1;0;20;Division 1;2021/2022
07.05.22;Girondins Bordeaux;Paris Saint-Germain;1;5;20;Division 1;2021/2022
08.05.22;Olympique Lyonnais;Paris FC;2;0;20;Division 1;2021/2022
27.05.22;Girondins Bordeaux;Paris FC;1;4;21;Division 1;2021/2022
28.05.22;Dijon FCO;Stade de Reims;2;2;21;Division 1;2021/2022
28.05.22;FC Fleury 91;AS Saint-Étienne;4;2;21;Division 1;2021/2022
28.05.22;GPSO 92 Issy;Montpellier HSC;2;5;21;Division 1;2021/2022
28.05.22;ASJ Soyaux;EA Guingamp;2;0;21;Division 1;2021/2022
29.05.22;Paris Saint-Germain;Olympique Lyonnais;0;1;21;Division 1;2021/2022
01.06.22;Stade de Reims;Paris Saint-Germain;1;0;22;Division 1;2021/2022
01.06.22;AS Saint-Étienne;ASJ Soyaux;0;3;22;Division 1;2021/2022
01.06.22;EA Guingamp;FC Fleury 91;0;3;22;Division 1;2021/2022
01.06.22;Paris FC;Dijon FCO;2;0;22;Division 1;2021/2022
01.06.22;Montpellier HSC;Girondins Bordeaux;0;1;22;Division 1;2021/2022
01.06.22;Olympique Lyonnais;GPSO 92 Issy;4;0;22;Division 1;2021/2022
09.09.22;Paris Saint-Germain;ASJ Soyaux;2;0;1;Division 1;2022/2023
10.09.22;EA Guingamp;FC Fleury 91;0;3;1;Division 1;2022/2023
10.09.22;Paris FC;Rodez AF;2;0;1;Division 1;2022/2023
10.09.22;Girondins Bordeaux;Havre AC;4;2;1;Division 1;2022/2023
10.09.22;Montpellier HSC;Dijon FCO;3;0;1;Division 1;2022/2023
11.09.22;Stade de Reims;Olympique Lyonnais;1;5;1;Division 1;2022/2023
16.09.22;FC Fleury 91;paris fc;1;1;2;Division 1;2022/2023
17.09.22;Dijon FCO;Girondins Bordeaux;1;1;2;Division 1;2022/2023
17.09.22;Rodez AF;Paris Saint-Germain;0;4;2;Division 1;2022/2023
17.09.22;Stade de Reims;Montpellier HSC;1;3;2;Division 1;2022/2023
18.09.22;Havre AC;EA Guingamp;1;0;2;Division 1;2022/2023
18.09.22;Olympique Lyonnais;ASJ Soyaux;2;1;2;Division 1;2022/2023
23.09.22;Paris FC;Havre AC;1;0;3;Division 1;2022/2023
23.09.22;Montpellier HSC;Olympique Lyonnais;1;3;3;Division 1;2022/2023
24.09.22;EA Guingamp;Dijon FCO;0;1;3;Division 1;2022/2023
24.09.22;Girondins Bordeaux;Stade de Reims;0;1;3;Division 1;2022/2023
24.09.22;ASJ Soyaux;Rodez AF;2;0;3;Division 1;2022/2023
25.09.22;Paris Saint-Germain;FC Fleury 91;2;1;3;Division 1;2022/2023
30.09.22;Montpellier HSC;Girondins Bordeaux;0;0;4;Division 1;2022/2023
01.10.22;Dijon FCO;Paris FC;0;2;4;Division 1;2022/2023
01.10.22;FC Fleury 91;ASJ Soyaux;1;1;4;Division 1;2022/2023
01.10.22;Olympique Lyonnais;Rodez AF;2;0;4;Division 1;2022/2023
01.10.22;Stade de Reims;EA Guingamp;3;0;4;Division 1;2022/2023
02.10.22;Havre AC;Paris Saint-Germain;2;2;4;Division 1;2022/2023
14.10.22;Paris FC;Stade de Reims;2;2;5;Division 1;2022/2023
15.10.22;EA Guingamp;Montpellier HSC;1;4;5;Division 1;2022/2023
15.10.22;Paris Saint-Germain;Dijon FCO;3;1;5;Division 1;2022/2023
15.10.22;ASJ Soyaux;Havre AC;1;4;5;Division 1;2022/2023
16.10.22;Girondins Bordeaux;Olympique Lyonnais;1;3;5;Division 1;2022/2023
16.10.22;Rodez AF;FC Fleury 91;2;1;5;Division 1;2022/2023
28.10.22;Montpellier HSC;Paris FC;1;3;6;Division 1;2022/2023
29.10.22;Havre AC;Rodez AF;2;1;6;Division 1;2022/2023
29.10.22;Dijon FCO;ASJ Soyaux;1;0;6;Division 1;2022/2023
29.10.22;Girondins Bordeaux;EA Guingamp;3;1;6;Division 1;2022/2023
29.10.22;Stade de Reims;Paris Saint-Germain;0;2;6;Division 1;2022/2023
30.10.22;Olympique Lyonnais;FC Fleury 91;1;0;6;Division 1;2022/2023
04.11.22;Rodez AF;Dijon FCO;1;1;7;Division 1;2022/2023
04.11.22;Paris FC;Girondins Bordeaux;1;1;7;Division 1;2022/2023
05.11.22;Paris Saint-Germain;Montpellier HSC;2;2;7;Division 1;2022/2023
05.11.22;EA Guingamp;Olympique Lyonnais;0;0;7;Division 1;2022/2023
05.11.22;FC Fleury 91;Havre AC;3;0;7;Division 1;2022/2023
05.11.22;ASJ Soyaux;Stade de Reims;1;4;7;Division 1;2022/2023
19.11.22;Dijon FCO;FC Fleury 91;1;5;8;Division 1;2022/2023
19.11.22;EA Guingamp;Paris FC;0;3;8;Division 1;2022/2023
19.11.22;Montpellier HSC;ASJ Soyaux;2;2;8;Division 1;2022/2023
19.11.22;Stade de Reims;Rodez AF;0;0;8;Division 1;2022/2023
20.11.22;Girondins Bordeaux;Paris Saint-Germain;0;3;8;Division 1;2022/2023
20.11.22;Olympique Lyonnais;Havre AC;1;0;8;Division 1;2022/2023
25.11.22;FC Fleury 91;Stade de Reims;1;0;9;Division 1;2022/2023
26.11.22;Havre AC;Dijon FCO;5;0;9;Division 1;2022/2023
26.11.22;Paris Saint-Germain;EA Guingamp;1;0;9;Division 1;2022/2023
26.11.22;Montpellier HSC;Rodez AF;2;1;9;Division 1;2022/2023
26.11.22;ASJ Soyaux;Girondins Bordeaux;0;1;9;Division 1;2022/2023
27.11.22;Paris FC;Olympique Lyonnais;2;3;9;Division 1;2022/2023
02.12.22;Montpellier HSC;FC Fleury 91;1;1;10;Division 1;2022/2023
03.12.22;EA Guingamp;ASJ Soyaux;3;1;10;Division 1;2022/2023
03.12.22;Girondins Bordeaux;Rodez AF;3;1;10;Division 1;2022/2023
03.12.22;Olympique Lyonnais;Dijon FCO;8;0;10;Division 1;2022/2023
03.12.22;Stade de Reims;Havre AC;3;1;10;Division 1;2022/2023
04.12.22;Paris FC;Paris Saint-Germain;0;1;10;Division 1;2022/2023
09.12.22;FC Fleury 91;Girondins Bordeaux;2;0;11;Division 1;2022/2023
10.12.22;Dijon FCO;Stade de Reims;0;4;11;Division 1;2022/2023
10.12.22;Rodez AF;EA Guingamp;1;2;11;Division 1;2022/2023
10.12.22;ASJ Soyaux;Paris FC;0;6;11;Division 1;2022/2023
11.12.22;Havre AC;Montpellier HSC;0;1;11;Division 1;2022/2023
11.12.22;Olympique Lyonnais;Paris Saint-Germain;0;1;11;Division 1;2022/2023
13.01.23;Paris Saint-Germain;Rodez AF;1;0;12;Division 1;2022/2023
14.01.23;EA Guingamp;Havre AC;2;2;12;Division 1;2022/2023
14.01.23;Girondins Bordeaux;Dijon FCO;2;0;12;Division 1;2022/2023
14.01.23;Montpellier HSC;Stade de Reims;2;0;12;Division 1;2022/2023
14.01.23;ASJ Soyaux;Olympique Lyonnais;0;3;12;Division 1;2022/2023
15.01.23;Paris FC;FC Fleury 91;0;2;12;Division 1;2022/2023
20.01.23;FC Fleury 91;Paris Saint-Germain;4;4;13;Division 1;2022/2023
21.01.23;Havre AC;Paris FC;1;3;13;Division 1;2022/2023
21.01.23;Dijon FCO;EA Guingamp;1;0;13;Division 1;2022/2023
21.01.23;Stade de Reims;Girondins Bordeaux;6;1;13;Division 1;2022/2023
21.01.23;Olympique Lyonnais;Montpellier HSC;2;0;13;Division 1;2022/2023
10.02.23;Rodez AF;ASJ Soyaux;1;0;13;Division 1;2022/2023
03.02.23;Girondins Bordeaux;Montpellier HSC;0;2;14;Division 1;2022/2023
04.02.23;EA Guingamp;Stade de Reims;2;0;14;Division 1;2022/2023
04.02.23;Paris FC;Dijon FCO;2;0;14;Division 1;2022/2023
04.02.23;Rodez AF;Olympique Lyonnais;0;5;14;Division 1;2022/2023
04.02.23;ASJ Soyaux;FC Fleury 91;0;4;14;Division 1;2022/2023
05.02.23;Paris Saint-Germain;Havre AC;3;1;14;Division 1;2022/2023
25.02.23;Havre AC;ASJ Soyaux;2;0;15;Division 1;2022/2023
25.02.23;FC Fleury 91;Rodez AF;6;0;15;Division 1;2022/2023
25.02.23;Montpellier HSC;EA Guingamp;0;1;15;Division 1;2022/2023
25.02.23;Stade de Reims;Paris FC;0;3;15;Division 1;2022/2023
26.02.23;Dijon FCO;Paris Saint-Germain;0;4;15;Division 1;2022/2023
26.02.23;Olympique Lyonnais;Girondins Bordeaux;3;0;15;Division 1;2022/2023
10.03.23;Paris FC;Montpellier HSC;2;0;16;Division 1;2022/2023
10.03.23;FC Fleury 91;Olympique Lyonnais;1;2;16;Division 1;2022/2023
11.03.23;EA Guingamp;Girondins Bordeaux;2;0;16;Division 1;2022/2023
11.03.23;Rodez AF;Havre AC;1;2;16;Division 1;2022/2023
11.03.23;ASJ Soyaux;Dijon FCO;1;1;16;Division 1;2022/2023
12.03.23;Paris Saint-Germain;Stade de Reims;4;0;16;Division 1;2022/2023
24.03.23;Havre AC;FC Fleury 91;1;1;17;Division 1;2022/2023
25.03.23;Dijon FCO;Rodez AF;1;2;17;Division 1;2022/2023
25.03.23;Girondins Bordeaux;Paris FC;0;0;17;Division 1;2022/2023
25.03.23;Stade de Reims;ASJ Soyaux;3;1;17;Division 1;2022/2023
25.03.23;Olympique Lyonnais;EA Guingamp;6;0;17;Division 1;2022/2023
26.03.23;Montpellier HSC;Paris Saint-Germain;0;1;17;Division 1;2022/2023
31.03.23;Rodez AF;Stade de Reims;1;2;18;Division 1;2022/2023
31.03.23;Paris FC;EA Guingamp;2;2;18;Division 1;2022/2023
01.04.23;FC Fleury 91;Dijon FCO;1;0;18;Division 1;2022/2023
01.04.23;ASJ Soyaux;Montpellier HSC;1;5;18;Division 1;2022/2023
02.04.23;Havre AC;Olympique Lyonnais;0;7;18;Division 1;2022/2023
02.04.23;Paris Saint-Germain;Girondins Bordeaux;1;0;18;Division 1;2022/2023
15.04.23;Dijon FCO;Havre AC;0;2;19;Division 1;2022/2023
15.04.23;Girondins Bordeaux;ASJ Soyaux;3;0;19;Division 1;2022/2023
15.04.23;Stade de Reims;FC Fleury 91;1;3;19;Division 1;2022/2023
16.04.23;EA Guingamp;Paris Saint-Germain;0;1;19;Division 1;2022/2023
16.04.23;Rodez AF;Montpellier HSC;2;3;19;Division 1;2022/2023
16.04.23;Olympique Lyonnais;Paris FC;2;0;19;Division 1;2022/2023
06.05.23;Havre AC;Stade de Reims;0;5;20;Division 1;2022/2023
06.05.23;Dijon FCO;Olympique Lyonnais;0;3;20;Division 1;2022/2023
06.05.23;FC Fleury 91;Montpellier HSC;1;2;20;Division 1;2022/2023
06.05.23;Rodez AF;Girondins Bordeaux;1;1;20;Division 1;2022/2023
06.05.23;ASJ Soyaux;EA Guingamp;1;2;20;Division 1;2022/2023
07.05.23;Paris Saint-Germain;Paris FC;0;0;20;Division 1;2022/2023
21.05.23;EA Guingamp;Rodez AF;2;1;21;Division 1;2022/2023
21.05.23;Paris FC;ASJ Soyaux;5;2;21;Division 1;2022/2023
21.05.23;Girondins Bordeaux;FC Fleury 91;1;1;21;Division 1;2022/2023
21.05.23;Montpellier HSC;Havre AC;2;1;21;Division 1;2022/2023
21.05.23;Stade de Reims;Dijon FCO;3;1;21;Division 1;2022/2023
21.05.23;Paris Saint-Germain;Olympique Lyonnais;0;1;21;Division 1;2022/2023
27.05.23;Havre AC;Girondins Bordeaux;2;4;22;Division 1;2022/2023
27.05.23;Dijon FCO;Montpellier HSC;2;1;22;Division 1;2022/2023
27.05.23;FC Fleury 91;EA Guingamp;6;0;22;Division 1;2022/2023
27.05.23;Olympique Lyonnais;Stade de Reims;7;1;22;Division 1;2022/2023
27.05.23;Rodez AF;Paris FC;0;4;22;Division 1;2022/2023
27.05.23;ASJ Soyaux;Paris Saint-Germain;0;3;22;Division 1;2022/2023
15.09.23;Havre AC;Olympique Lyonnais;0;4;1;Division 1;2023/2024
16.09.23;FC Fleury 91;EA Guingamp;3;1;1;Division 1;2023/2024
16.09.23;Montpellier HSC;Dijon FCO;2;0;1;Division 1;2023/2024
16.09.23;Lille OSC;Paris FC;0;4;1;Division 1;2023/2024
16.09.23;Stade de Reims;AS Saint-Étienne;2;0;1;Division 1;2023/2024
17.09.23;Girondins Bordeaux;Paris Saint-Germain;0;3;1;Division 1;2023/2024
29.09.23;Paris FC;FC Fleury 91;3;1;2;Division 1;2023/2024
30.09.23;EA Guingamp;Stade de Reims;0;0;2;Division 1;2023/2024
30.09.23;AS Saint-Étienne;Montpellier HSC;1;1;2;Division 1;2023/2024
30.09.23;Dijon FCO;Lille OSC;3;3;2;Division 1;2023/2024
30.09.23;Girondins Bordeaux;Havre AC;1;1;2;Division 1;2023/2024
01.10.23;Paris Saint-Germain;Olympique Lyonnais;0;1;2;Division 1;2023/2024
06.10.23;AS Saint-Étienne;Paris Saint-Germain;0;1;3;Division 1;2023/2024
06.10.23;Havre AC;Paris FC;1;4;3;Division 1;2023/2024
07.10.23;Montpellier HSC;EA Guingamp;3;1;3;Division 1;2023/2024
07.10.23;Lille OSC;FC Fleury 91;2;1;3;Division 1;2023/2024
07.10.23;Stade de Reims;Dijon FCO;1;0;3;Division 1;2023/2024
08.10.23;Olympique Lyonnais;Girondins Bordeaux;4;0;3;Division 1;2023/2024
13.10.23;Girondins Bordeaux;Montpellier HSC;1;1;4;Division 1;2023/2024
14.10.23;Havre AC;Lille OSC;2;2;4;Division 1;2023/2024
14.10.23;Paris FC;EA Guingamp;2;0;4;Division 1;2023/2024
14.10.23;FC Fleury 91;Dijon FCO;2;1;4;Division 1;2023/2024
14.10.23;Olympique Lyonnais;AS Saint-Étienne;6;0;4;Division 1;2023/2024
17.01.24;Paris Saint-Germain;Stade de Reims;4;0;4;Division 1;2023/2024
20.10.23;Montpellier HSC;FC Fleury 91;1;1;5;Division 1;2023/2024
21.10.23;AS Saint-Étienne;Havre AC;1;2;5;Division 1;2023/2024
21.10.23;EA Guingamp;Girondins Bordeaux;1;0;5;Division 1;2023/2024
21.10.23;Lille OSC;Paris Saint-Germain;0;4;5;Division 1;2023/2024
22.10.23;Dijon FCO;Paris FC;0;6;5;Division 1;2023/2024
22.10.23;Stade de Reims;Olympique Lyonnais;1;5;5;Division 1;2023/2024
03.11.23;Lille OSC;Montpellier HSC;0;0;6;Division 1;2023/2024
04.11.23;Girondins Bordeaux;Stade de Reims;0;2;6;Division 1;2023/2024
04.11.23;Havre AC;Dijon FCO;3;3;6;Division 1;2023/2024
04.11.23;FC Fleury 91;AS Saint-Étienne;2;1;6;Division 1;2023/2024
05.11.23;Paris FC;Olympique Lyonnais;1;6;6;Division 1;2023/2024
17.02.24;Paris Saint-Germain;EA Guingamp;5;0;6;Division 1;2023/2024
10.11.23;Olympique Lyonnais;Montpellier HSC;5;0;7;Division 1;2023/2024
11.11.23;FC Fleury 91;Girondins Bordeaux;2;1;7;Division 1;2023/2024
11.11.23;AS Saint-Étienne;Paris FC;1;6;7;Division 1;2023/2024
11.11.23;EA Guingamp;Lille OSC;4;3;7;Division 1;2023/2024
11.11.23;Stade de Reims;Havre AC;0;0;7;Division 1;2023/2024
12.11.23;Dijon FCO;Paris Saint-Germain;2;5;7;Division 1;2023/2024
17.11.23;Olympique Lyonnais;Dijon FCO;4;1;8;Division 1;2023/2024
18.11.23;Havre AC;EA Guingamp;2;0;8;Division 1;2023/2024
18.11.23;Montpellier HSC;Stade de Reims;2;1;8;Division 1;2023/2024
18.11.23;Lille OSC;AS Saint-Étienne;1;2;8;Division 1;2023/2024
19.11.23;Paris Saint-Germain;FC Fleury 91;2;1;8;Division 1;2023/2024
19.11.23;Paris FC;Girondins Bordeaux;1;0;8;Division 1;2023/2024
24.11.23;FC Fleury 91;Havre AC;3;0;9;Division 1;2023/2024
25.11.23;Dijon FCO;AS Saint-Étienne;3;2;9;Division 1;2023/2024
25.11.23;Girondins Bordeaux;Lille OSC;3;0;9;Division 1;2023/2024
26.11.23;Paris Saint-Germain;Montpellier HSC;4;1;9;Division 1;2023/2024
26.11.23;Stade de Reims;Paris FC;1;1;9;Division 1;2023/2024
26.11.23;EA Guingamp;Olympique Lyonnais;1;5;9;Division 1;2023/2024
08.12.23;Olympique Lyonnais;Lille OSC;5;0;10;Division 1;2023/2024
09.12.23;AS Saint-Étienne;EA Guingamp;2;1;10;Division 1;2023/2024
09.12.23;Dijon FCO;Girondins Bordeaux;1;0;10;Division 1;2023/2024
09.12.23;Montpellier HSC;Paris FC;1;4;10;Division 1;2023/2024
09.12.23;Stade de Reims;FC Fleury 91;2;0;10;Division 1;2023/2024
10.12.23;Havre AC;Paris Saint-Germain;1;1;10;Division 1;2023/2024
15.12.23;Montpellier HSC;Havre AC;2;1;11;Division 1;2023/2024
16.12.23;FC Fleury 91;Olympique Lyonnais;1;3;11;Division 1;2023/2024
16.12.23;EA Guingamp;Dijon FCO;1;1;11;Division 1;2023/2024
16.12.23;Lille OSC;Stade de Reims;2;5;11;Division 1;2023/2024
16.12.23;Girondins Bordeaux;AS Saint-Étienne;1;4;11;Division 1;2023/2024
17.12.23;Paris FC;Paris Saint-Germain;1;2;11;Division 1;2023/2024
09.01.24;Paris Saint-Germain;Lille OSC;6;0;12;Division 1;2023/2024
10.01.24;Dijon FCO;FC Fleury 91;0;5;12;Division 1;2023/2024
10.01.24;EA Guingamp;Montpellier HSC;0;1;12;Division 1;2023/2024
10.01.24;Olympique Lyonnais;Paris FC;1;0;12;Division 1;2023/2024
17.02.24;Havre AC;Girondins Bordeaux;1;1;12;Division 1;2023/2024
17.02.24;AS Saint-Étienne;Stade de Reims;4;3;12;Division 1;2023/2024
20.01.24;Lille OSC;Dijon FCO;2;2;13;Division 1;2023/2024
20.01.24;Stade de Reims;EA Guingamp;1;0;13;Division 1;2023/2024
20.01.24;Paris Saint-Germain;Girondins Bordeaux;8;1;13;Division 1;2023/2024
21.01.24;AS Saint-Étienne;FC Fleury 91;1;0;13;Division 1;2023/2024
21.01.24;Montpellier HSC;Olympique Lyonnais;1;2;13;Division 1;2023/2024
06.03.24;Paris FC;Havre AC;3;2;13;Division 1;2023/2024
02.02.24;FC Fleury 91;Paris Saint-Germain;1;1;14;Division 1;2023/2024
03.02.24;Havre AC;AS Saint-Étienne;4;2;14;Division 1;2023/2024
03.02.24;Dijon FCO;Montpellier HSC;1;0;14;Division 1;2023/2024
03.02.24;Girondins Bordeaux;EA Guingamp;1;1;14;Division 1;2023/2024
03.02.24;Olympique Lyonnais;Stade de Reims;4;1;14;Division 1;2023/2024
04.02.24;Paris FC;Lille OSC;3;2;14;Division 1;2023/2024
09.02.24;Stade de Reims;Montpellier HSC;0;3;15;Division 1;2023/2024
10.02.24;Girondins Bordeaux;Paris FC;2;6;15;Division 1;2023/2024
10.02.24;AS Saint-Étienne;Dijon FCO;2;0;15;Division 1;2023/2024
10.02.24;EA Guingamp;FC Fleury 91;3;1;15;Division 1;2023/2024
10.02.24;Lille OSC;Havre AC;3;3;15;Division 1;2023/2024
11.02.24;Olympique Lyonnais;Paris Saint-Germain;1;1;15;Division 1;2023/2024
02.03.24;FC Fleury 91;Stade de Reims;1;0;16;Division 1;2023/2024
02.03.24;Montpellier HSC;Girondins Bordeaux;2;1;16;Division 1;2023/2024
02.03.24;Lille OSC;EA Guingamp;0;2;16;Division 1;2023/2024
02.03.24;Paris Saint-Germain;Havre AC;4;0;16;Division 1;2023/2024
03.03.24;Dijon FCO;Olympique Lyonnais;1;3;16;Division 1;2023/2024
19.04.24;Paris FC;AS Saint-Étienne;0;1;16;Division 1;2023/2024
15.03.24;Olympique Lyonnais;FC Fleury 91;4;0;17;Division 1;2023/2024
16.03.24;EA Guingamp;Paris FC;0;4;17;Division 1;2023/2024
16.03.24;Girondins Bordeaux;Dijon FCO;0;2;17;Division 1;2023/2024
16.03.24;Paris Saint-Germain;AS Saint-Étienne;5;0;17;Division 1;2023/2024
16.03.24;Stade de Reims;Lille OSC;3;1;17;Division 1;2023/2024
17.03.24;Havre AC;Montpellier HSC;3;3;17;Division 1;2023/2024
22.03.24;FC Fleury 91;Paris FC;2;1;18;Division 1;2023/2024
23.03.24;Lille OSC;Olympique Lyonnais;0;7;18;Division 1;2023/2024
23.03.24;Dijon FCO;EA Guingamp;2;0;18;Division 1;2023/2024
23.03.24;Havre AC;Stade de Reims;0;2;18;Division 1;2023/2024
23.03.24;AS Saint-Étienne;Girondins Bordeaux;1;0;18;Division 1;2023/2024
24.03.24;Montpellier HSC;Paris Saint-Germain;1;3;18;Division 1;2023/2024
29.03.24;Paris FC;Montpellier HSC;3;0;19;Division 1;2023/2024
30.03.24;EA Guingamp;AS Saint-Étienne;3;4;19;Division 1;2023/2024
30.03.24;FC Fleury 91;Lille OSC;2;2;19;Division 1;2023/2024
30.03.24;Stade de Reims;Girondins Bordeaux;3;0;19;Division 1;2023/2024
31.03.24;Paris Saint-Germain;Dijon FCO;3;0;19;Division 1;2023/2024
31.03.24;Olympique Lyonnais;Havre AC;3;0;19;Division 1;2023/2024
12.04.24;Paris FC;Stade de Reims;2;2;20;Division 1;2023/2024
13.04.24;EA Guingamp;Paris Saint-Germain;3;3;20;Division 1;2023/2024
13.04.24;Montpellier HSC;Lille OSC;1;2;20;Division 1;2023/2024
13.04.24;Dijon FCO;Havre AC;1;2;20;Division 1;2023/2024
14.04.24;Girondins Bordeaux;FC Fleury 91;0;3;20;Division 1;2023/2024
14.04.24;AS Saint-Étienne;Olympique Lyonnais;1;6;20;Division 1;2023/2024
24.04.24;Paris Saint-Germain;Paris FC;1;1;21;Division 1;2023/2024
24.04.24;Havre AC;FC Fleury 91;1;3;21;Division 1;2023/2024
24.04.24;Dijon FCO;Stade de Reims;1;1;21;Division 1;2023/2024
24.04.24;Montpellier HSC;AS Saint-Étienne;4;0;21;Division 1;2023/2024
24.04.24;Lille OSC;Girondins Bordeaux;1;2;21;Division 1;2023/2024
24.04.24;Olympique Lyonnais;EA Guingamp;2;1;21;Division 1;2023/2024
08.05.24;AS Saint-Étienne;Lille OSC;1;1;22;Division 1;2023/2024
08.05.24;EA Guingamp;Havre AC;3;4;22;Division 1;2023/2024
08.05.24;Paris FC;Dijon FCO;0;1;22;Division 1;2023/2024
08.05.24;FC Fleury 91;Montpellier HSC;2;3;22;Division 1;2023/2024
08.05.24;Girondins Bordeaux;Olympique Lyonnais;2;1;22;Division 1;2023/2024
08.05.24;Stade de Reims;Paris Saint-Germain;2;1;22;Division 1;2023/2024
11.05.24;Paris Saint-Germain;Paris FC;5;4;Halbfinale;Division 1 - Playoffs;2023/2024
12.05.24;Olympique Lyonnais;Stade de Reims;6;0;Halbfinale;Division 1 - Playoffs;2023/2024
17.05.24;Paris FC;Stade de Reims;4;2;3. Platz;Division 1 - Playoffs;2023/2024
17.05.24;Olympique Lyonnais;Paris Saint-Germain;2;1;Finale;Division 1 - Playoffs;2023/2024
20.09.24;FC Fleury 91;OL Lyonnes;2;6;1;Division 1;2024/2025
21.09.24;RC Strasbourg;Dijon FCO;1;1;1;Division 1;2024/2025
21.09.24;Stade de Reims;AS Saint-Étienne;1;2;1;Division 1;2024/2025
21.09.24;Havre AC;FC Nantes;0;1;1;Division 1;2024/2025
21.09.24;Montpellier HSC;Paris Saint-Germain;1;3;1;Division 1;2024/2025
22.09.24;EA Guingamp;Paris FC;0;6;1;Division 1;2024/2025
27.09.24;OL Lyonnes;RC Strasbourg;6;0;2;Division 1;2024/2025
28.09.24;Dijon FCO;FC Fleury 91;2;2;2;Division 1;2024/2025
28.09.24;FC Nantes;AS Saint-Étienne;0;1;2;Division 1;2024/2025
28.09.24;Montpellier HSC;Stade de Reims;1;0;2;Division 1;2024/2025
29.09.24;Paris Saint-Germain;EA Guingamp;4;0;2;Division 1;2024/2025
29.09.24;Paris FC;Havre AC;8;0;2;Division 1;2024/2025
04.10.24;Paris Saint-Germain;Havre AC;3;0;3;Division 1;2024/2025
05.10.24;AS Saint-Étienne;Paris FC;1;0;3;Division 1;2024/2025
05.10.24;Stade de Reims;Dijon FCO;0;2;3;Division 1;2024/2025
05.10.24;RC Strasbourg;FC Fleury 91;0;2;3;Division 1;2024/2025
05.10.24;EA Guingamp;FC Nantes;0;1;3;Division 1;2024/2025
05.10.24;OL Lyonnes;Montpellier HSC;4;0;3;Division 1;2024/2025
11.10.24;Havre AC;AS Saint-Étienne;5;1;4;Division 1;2024/2025
12.10.24;Dijon FCO;OL Lyonnes;0;3;4;Division 1;2024/2025
12.10.24;Paris FC;Stade de Reims;3;2;4;Division 1;2024/2025
12.10.24;FC Fleury 91;EA Guingamp;4;1;4;Division 1;2024/2025
12.10.24;Montpellier HSC;RC Strasbourg;0;0;4;Division 1;2024/2025
12.10.24;FC Nantes;Paris Saint-Germain;0;1;4;Division 1;2024/2025
18.10.24;Havre AC;Montpellier HSC;0;1;5;Division 1;2024/2025
18.10.24;Paris Saint-Germain;FC Fleury 91;2;1;5;Division 1;2024/2025
19.10.24;AS Saint-Étienne;Dijon FCO;0;2;5;Division 1;2024/2025
19.10.24;EA Guingamp;RC Strasbourg;3;2;5;Division 1;2024/2025
19.10.24;Stade de Reims;FC Nantes;1;3;5;Division 1;2024/2025
20.10.24;Paris FC;OL Lyonnes;0;0;5;Division 1;2024/2025
02.11.24;FC Nantes;Paris FC;0;0;6;Division 1;2024/2025
02.11.24;FC Fleury 91;Stade de Reims;4;1;6;Division 1;2024/2025
02.11.24;Montpellier HSC;EA Guingamp;7;0;6;Division 1;2024/2025
02.11.24;Dijon FCO;Havre AC;4;2;6;Division 1;2024/2025
02.11.24;RC Strasbourg;AS Saint-Étienne;2;0;6;Division 1;2024/2025
03.11.24;OL Lyonnes;Paris Saint-Germain;1;0;6;Division 1;2024/2025
08.11.24;Havre AC;Stade de Reims;0;3;7;Division 1;2024/2025
08.11.24;EA Guingamp;OL Lyonnes;0;8;7;Division 1;2024/2025
09.11.24;Paris Saint-Germain;RC Strasbourg;4;0;7;Division 1;2024/2025
09.11.24;AS Saint-Étienne;FC Fleury 91;3;2;7;Division 1;2024/2025
09.11.24;FC Nantes;Dijon FCO;0;2;7;Division 1;2024/2025
09.11.24;Paris FC;Montpellier HSC;4;2;7;Division 1;2024/2025
15.11.24;FC Fleury 91;Havre AC;2;0;8;Division 1;2024/2025
15.11.24;Montpellier HSC;FC Nantes;1;0;8;Division 1;2024/2025
16.11.24;Stade de Reims;Paris Saint-Germain;1;2;8;Division 1;2024/2025
16.11.24;RC Strasbourg;Paris FC;1;4;8;Division 1;2024/2025
16.11.24;Dijon FCO;EA Guingamp;4;0;8;Division 1;2024/2025
16.11.24;OL Lyonnes;AS Saint-Étienne;11;0;8;Division 1;2024/2025
23.11.24;AS Saint-Étienne;Montpellier HSC;0;2;9;Division 1;2024/2025
23.11.24;Havre AC;OL Lyonnes;0;3;9;Division 1;2024/2025
23.11.24;EA Guingamp;Stade de Reims;1;4;9;Division 1;2024/2025
23.11.24;Paris Saint-Germain;Dijon FCO;6;1;9;Division 1;2024/2025
24.11.24;FC Fleury 91;Paris FC;1;4;9;Division 1;2024/2025
11.12.24;RC Strasbourg;FC Nantes;1;2;9;Division 1;2024/2025
06.12.24;Stade de Reims;OL Lyonnes;0;3;10;Division 1;2024/2025
07.12.24;FC Nantes;FC Fleury 91;0;0;10;Division 1;2024/2025
07.12.24;Dijon FCO;Montpellier HSC;4;2;10;Division 1;2024/2025
07.12.24;AS Saint-Étienne;EA Guingamp;2;0;10;Division 1;2024/2025
07.12.24;Havre AC;RC Strasbourg;1;1;10;Division 1;2024/2025
07.12.24;Paris FC;Paris Saint-Germain;1;1;10;Division 1;2024/2025
13.12.24;AS Saint-Étienne;Paris Saint-Germain;0;3;11;Division 1;2024/2025
14.12.24;Paris FC;Dijon FCO;4;0;11;Division 1;2024/2025
14.12.24;Stade de Reims;RC Strasbourg;0;0;11;Division 1;2024/2025
14.12.24;Montpellier HSC;FC Fleury 91;0;1;11;Division 1;2024/2025
14.12.24;EA Guingamp;Havre AC;0;1;11;Division 1;2024/2025
14.12.24;OL Lyonnes;FC Nantes;5;1;11;Division 1;2024/2025
07.01.25;FC Fleury 91;Paris Saint-Germain;0;0;12;Division 1;2024/2025
08.01.25;Havre AC;Paris FC;0;2;12;Division 1;2024/2025
08.01.25;AS Saint-Étienne;Stade de Reims;0;3;12;Division 1;2024/2025
08.01.25;RC Strasbourg;Montpellier HSC;1;2;12;Division 1;2024/2025
08.01.25;FC Nantes;EA Guingamp;2;1;12;Division 1;2024/2025
08.01.25;OL Lyonnes;Dijon FCO;2;0;12;Division 1;2024/2025
17.01.25;FC Fleury 91;AS Saint-Étienne;6;0;13;Division 1;2024/2025
18.01.25;Paris FC;EA Guingamp;6;0;13;Division 1;2024/2025
18.01.25;FC Nantes;Stade de Reims;1;1;13;Division 1;2024/2025
18.01.25;Montpellier HSC;Havre AC;1;3;13;Division 1;2024/2025
18.01.25;Dijon FCO;RC Strasbourg;1;0;13;Division 1;2024/2025
18.01.25;Paris Saint-Germain;OL Lyonnes;0;2;13;Division 1;2024/2025
31.01.25;Montpellier HSC;OL Lyonnes;1;4;14;Division 1;2024/2025
01.02.25;Stade de Reims;Paris FC;0;3;14;Division 1;2024/2025
01.02.25;Havre AC;FC Fleury 91;0;0;14;Division 1;2024/2025
01.02.25;AS Saint-Étienne;FC Nantes;2;2;14;Division 1;2024/2025
01.02.25;EA Guingamp;Dijon FCO;0;3;14;Division 1;2024/2025
01.02.25;RC Strasbourg;Paris Saint-Germain;1;2;14;Division 1;2024/2025
14.02.25;Paris FC;AS Saint-Étienne;4;0;15;Division 1;2024/2025
15.02.25;OL Lyonnes;EA Guingamp;7;0;15;Division 1;2024/2025
15.02.25;Dijon FCO;Stade de Reims;2;1;15;Division 1;2024/2025
15.02.25;FC Fleury 91;RC Strasbourg;1;1;15;Division 1;2024/2025
15.02.25;FC Nantes;Havre AC;2;2;15;Division 1;2024/2025
15.02.25;Paris Saint-Germain;Montpellier HSC;4;1;15;Division 1;2024/2025
01.03.25;Dijon FCO;Paris Saint-Germain;0;1;16;Division 1;2024/2025
01.03.25;AS Saint-Étienne;Havre AC;1;2;16;Division 1;2024/2025
01.03.25;Paris FC;FC Nantes;0;0;16;Division 1;2024/2025
01.03.25;Stade de Reims;Montpellier HSC;2;4;16;Division 1;2024/2025
01.03.25;EA Guingamp;FC Fleury 91;0;6;16;Division 1;2024/2025
01.03.25;RC Strasbourg;OL Lyonnes;0;4;16;Division 1;2024/2025
14.03.25;OL Lyonnes;Stade de Reims;8;1;17;Division 1;2024/2025
15.03.25;FC Nantes;RC Strasbourg;0;0;17;Division 1;2024/2025
15.03.25;FC Fleury 91;Dijon FCO;0;0;17;Division 1;2024/2025
15.03.25;Havre AC;EA Guingamp;2;1;17;Division 1;2024/2025
15.03.25;Paris Saint-Germain;Paris FC;0;0;17;Division 1;2024/2025
16.03.25;Montpellier HSC;AS Saint-Étienne;1;0;17;Division 1;2024/2025
21.03.25;EA Guingamp;Paris Saint-Germain;2;6;18;Division 1;2024/2025
22.03.25;Paris FC;RC Strasbourg;3;1;18;Division 1;2024/2025
22.03.25;Stade de Reims;FC Fleury 91;0;1;18;Division 1;2024/2025
22.03.25;FC Nantes;Montpellier HSC;2;2;18;Division 1;2024/2025
22.03.25;Havre AC;Dijon FCO;0;2;18;Division 1;2024/2025
22.03.25;AS Saint-Étienne;OL Lyonnes;0;5;18;Division 1;2024/2025
29.03.25;Stade de Reims;Havre AC;1;1;19;Division 1;2024/2025
29.03.25;Montpellier HSC;Paris FC;2;0;19;Division 1;2024/2025
29.03.25;Dijon FCO;FC Nantes;3;0;19;Division 1;2024/2025
29.03.25;RC Strasbourg;EA Guingamp;6;0;19;Division 1;2024/2025
29.03.25;Paris Saint-Germain;AS Saint-Étienne;6;0;19;Division 1;2024/2025
30.03.25;OL Lyonnes;FC Fleury 91;4;0;19;Division 1;2024/2025
11.04.25;Paris Saint-Germain;Stade de Reims;6;0;20;Division 1;2024/2025
12.04.25;FC Fleury 91;FC Nantes;4;0;20;Division 1;2024/2025
12.04.25;EA Guingamp;Montpellier HSC;3;1;20;Division 1;2024/2025
12.04.25;Dijon FCO;AS Saint-Étienne;1;0;20;Division 1;2024/2025
12.04.25;OL Lyonnes;Paris FC;2;2;20;Division 1;2024/2025
13.04.25;RC Strasbourg;Havre AC;1;1;20;Division 1;2024/2025
23.04.25;FC Nantes;OL Lyonnes;0;2;21;Division 1;2024/2025
23.04.25;Havre AC;Paris Saint-Germain;2;2;21;Division 1;2024/2025
23.04.25;Paris FC;FC Fleury 91;4;0;21;Division 1;2024/2025
23.04.25;Stade de Reims;EA Guingamp;1;0;21;Division 1;2024/2025
23.04.25;Montpellier HSC;Dijon FCO;0;0;21;Division 1;2024/2025
23.04.25;AS Saint-Étienne;RC Strasbourg;1;1;21;Division 1;2024/2025
07.05.25;OL Lyonnes;Havre AC;2;0;22;Division 1;2024/2025
07.05.25;Paris Saint-Germain;FC Nantes;1;0;22;Division 1;2024/2025
07.05.25;Dijon FCO;Paris FC;6;0;22;Division 1;2024/2025
07.05.25;RC Strasbourg;Stade de Reims;2;1;22;Division 1;2024/2025
07.05.25;FC Fleury 91;Montpellier HSC;1;2;22;Division 1;2024/2025
07.05.25;EA Guingamp;AS Saint-Étienne;3;2;22;Division 1;2024/2025
11.05.25;OL Lyonnes;Dijon FCO;4;1;Halbfinale;Division 1 - Playoffs;2024/2025
11.05.25;Paris Saint-Germain;Paris FC;3;0;Halbfinale;Division 1 - Playoffs;2024/2025
16.05.25;OL Lyonnes;Paris Saint-Germain;3;0;Finale;Division 1 - Playoffs;2024/2025
06.09.25;Havre AC;RC Strasbourg;2;2;1;Division 1;2025/2026
06.09.25;FC Nantes;AS Saint-Étienne;2;1;1;Division 1;2025/2026
06.09.25;Paris FC;Dijon FCO;2;0;1;Division 1;2025/2026
06.09.25;Montpellier HSC;FC Fleury 91;1;2;1;Division 1;2025/2026
06.09.25;RC Lens;Paris Saint-Germain;0;3;1;Division 1;2025/2026
07.09.25;OL Lyonnes;Olympique Marseille;3;1;1;Division 1;2025/2026
19.09.25;Olympique Marseille;Havre AC;1;2;2;Division 1;2025/2026
20.09.25;AS Saint-Étienne;OL Lyonnes;0;2;2;Division 1;2025/2026
20.09.25;Dijon FCO;Montpellier HSC;2;1;2;Division 1;2025/2026
20.09.25;RC Strasbourg;RC Lens;2;2;2;Division 1;2025/2026
20.09.25;Paris Saint-Germain;FC Nantes;5;2;2;Division 1;2025/2026
21.09.25;FC Fleury 91;Paris FC;0;2;2;Division 1;2025/2026
26.09.25;Paris FC;AS Saint-Étienne;2;0;3;Division 1;2025/2026
27.09.25;Havre AC;Montpellier HSC;3;2;3;Division 1;2025/2026
27.09.25;Dijon FCO;RC Strasbourg;0;4;3;Division 1;2025/2026
27.09.25;RC Lens;FC Nantes;3;4;3;Division 1;2025/2026
27.09.25;Olympique Marseille;FC Fleury 91;0;2;3;Division 1;2025/2026
27.09.25;OL Lyonnes;Paris Saint-Germain;6;1;3;Division 1;2025/2026
03.10.25;RC Lens;OL Lyonnes;1;8;4;Division 1;2025/2026
03.10.25;FC Nantes;Paris FC;3;1;4;Division 1;2025/2026
04.10.25;Montpellier HSC;RC Strasbourg;2;0;4;Division 1;2025/2026
04.10.25;AS Saint-Étienne;Olympique Marseille;0;4;4;Division 1;2025/2026
04.10.25;FC Fleury 91;Havre AC;1;0;4;Division 1;2025/2026
04.10.25;Paris Saint-Germain;Dijon FCO;1;0;4;Division 1;2025/2026
17.10.25;Havre AC;AS Saint-Étienne;0;0;5;Division 1;2025/2026
18.10.25;Dijon FCO;FC Fleury 91;1;1;5;Division 1;2025/2026
18.10.25;Paris FC;Olympique Marseille;6;1;5;Division 1;2025/2026
18.10.25;Montpellier HSC;RC Lens;3;1;5;Division 1;2025/2026
18.10.25;OL Lyonnes;FC Nantes;6;1;5;Division 1;2025/2026
19.10.25;RC Strasbourg;Paris Saint-Germain;3;0;5;Division 1;2025/2026
31.10.25;Olympique Marseille;RC Strasbourg;0;0;6;Division 1;2025/2026
01.11.25;AS Saint-Étienne;Montpellier HSC;4;2;6;Division 1;2025/2026
01.11.25;FC Nantes;Dijon FCO;1;2;6;Division 1;2025/2026
01.11.25;FC Fleury 91;RC Lens;4;0;6;Division 1;2025/2026
01.11.25;Paris Saint-Germain;Havre AC;0;3;6;Division 1;2025/2026
01.11.25;OL Lyonnes;Paris FC;1;0;6;Division 1;2025/2026
07.11.25;Montpellier HSC;OL Lyonnes;1;5;7;Division 1;2025/2026
07.11.25;RC Lens;Paris FC;1;2;7;Division 1;2025/2026
07.11.25;Dijon FCO;Olympique Marseille;1;1;7;Division 1;2025/2026
08.11.25;FC Nantes;Havre AC;2;1;7;Division 1;2025/2026
08.11.25;Paris Saint-Germain;FC Fleury 91;0;3;7;Division 1;2025/2026
19.11.25;RC Strasbourg;AS Saint-Étienne;2;0;7;Division 1;2025/2026
21.11.25;Olympique Marseille;RC Lens;2;0;8;Division 1;2025/2026
22.11.25;Havre AC;Dijon FCO;0;1;8;Division 1;2025/2026
22.11.25;Paris FC;Montpellier HSC;2;1;8;Division 1;2025/2026
22.11.25;FC Fleury 91;FC Nantes;1;2;8;Division 1;2025/2026
22.11.25;OL Lyonnes;RC Strasbourg;5;0;8;Division 1;2025/2026
23.11.25;AS Saint-Étienne;Paris Saint-Germain;1;4;8;Division 1;2025/2026
05.12.25;Olympique Marseille;Paris Saint-Germain;1;5;9;Division 1;2025/2026
05.12.25;RC Lens;AS Saint-Étienne;1;0;9;Division 1;2025/2026
06.12.25;Dijon FCO;OL Lyonnes;0;3;9;Division 1;2025/2026
06.12.25;Paris FC;Havre AC;3;0;9;Division 1;2025/2026
06.12.25;Montpellier HSC;FC Nantes;1;2;9;Division 1;2025/2026
06.12.25;RC Strasbourg;FC Fleury 91;0;3;9;Division 1;2025/2026
12.12.25;Paris Saint-Germain;Montpellier HSC;2;2;10;Division 1;2025/2026
13.12.25;Havre AC;OL Lyonnes;0;7;10;Division 1;2025/2026
13.12.25;Dijon FCO;RC Lens;1;1;10;Division 1;2025/2026
13.12.25;FC Fleury 91;AS Saint-Étienne;0;0;10;Division 1;2025/2026
13.12.25;RC Strasbourg;Paris FC;0;0;10;Division 1;2025/2026
14.12.25;FC Nantes;Olympique Marseille;3;0;10;Division 1;2025/2026
20.12.25;AS Saint-Étienne;Dijon FCO;0;1;11;Division 1;2025/2026
20.12.25;FC Nantes;RC Strasbourg;0;1;11;Division 1;2025/2026
20.12.25;Montpellier HSC;Olympique Marseille;0;3;11;Division 1;2025/2026
20.12.25;RC Lens;Havre AC;2;1;11;Division 1;2025/2026
20.12.25;OL Lyonnes;FC Fleury 91;3;0;11;Division 1;2025/2026
20.12.25;Paris Saint-Germain;Paris FC;0;0;11;Division 1;2025/2026
14.01.26;Havre AC;FC Fleury 91;1;1;12;Division 1;2025/2026
14.01.26;Dijon FCO;Paris Saint-Germain;0;4;12;Division 1;2025/2026
14.01.26;OL Lyonnes;RC Lens;1;0;12;Division 1;2025/2026
14.01.26;Olympique Marseille;AS Saint-Étienne;0;1;12;Division 1;2025/2026
14.01.26;RC Strasbourg;Montpellier HSC;2;1;12;Division 1;2025/2026
14.01.26;Paris FC;FC Nantes;1;2;12;Division 1;2025/2026
17.01.26;RC Lens;RC Strasbourg;0;1;13;Division 1;2025/2026
17.01.26;AS Saint-Étienne;FC Nantes;0;1;13;Division 1;2025/2026
17.01.26;FC Fleury 91;Olympique Marseille;1;1;13;Division 1;2025/2026
17.01.26;Montpellier HSC;Dijon FCO;1;1;13;Division 1;2025/2026
17.01.26;Havre AC;Paris Saint-Germain;0;4;13;Division 1;2025/2026
18.01.26;Paris FC;OL Lyonnes;0;0;13;Division 1;2025/2026
30.01.26;Olympique Marseille;Paris FC;0;3;14;Division 1;2025/2026
31.01.26;AS Saint-Étienne;Havre AC;1;1;14;Division 1;2025/2026
31.01.26;FC Nantes;RC Lens;2;2;14;Division 1;2025/2026
31.01.26;FC Fleury 91;Montpellier HSC;1;0;14;Division 1;2025/2026
31.01.26;RC Strasbourg;Dijon FCO;0;3;14;Division 1;2025/2026
01.02.26;Paris Saint-Germain;OL Lyonnes;0;1;14;Division 1;2025/2026
07.02.26;RC Lens;FC Fleury 91;0;2;15;Division 1;2025/2026
07.02.26;Dijon FCO;FC Nantes;1;1;15;Division 1;2025/2026
07.02.26;Montpellier HSC;Havre AC;1;2;15;Division 1;2025/2026
07.02.26;Paris FC;Paris Saint-Germain;0;3;15;Division 1;2025/2026
08.02.26;OL Lyonnes;AS Saint-Étienne;4;0;15;Division 1;2025/2026
08.02.26;RC Strasbourg;Olympique Marseille;2;4;15;Division 1;2025/2026
20.02.26;Paris Saint-Germain;RC Lens;3;0;16;Division 1;2025/2026
21.02.26;AS Saint-Étienne;RC Strasbourg;0;2;16;Division 1;2025/2026
21.02.26;FC Nantes;Montpellier HSC;2;2;16;Division 1;2025/2026
21.02.26;FC Fleury 91;Dijon FCO;0;0;16;Division 1;2025/2026
21.02.26;Olympique Marseille;OL Lyonnes;2;6;16;Division 1;2025/2026
22.02.26;Havre AC;Paris FC;0;4;16;Division 1;2025/2026
10.03.26;OL Lyonnes;Havre AC;3;0;17;Division 1;2025/2026
11.03.26;Paris FC;RC Strasbourg;3;0;17;Division 1;2025/2026
11.03.26;Paris Saint-Germain;Olympique Marseille;2;1;17;Division 1;2025/2026
11.03.26;Dijon FCO;AS Saint-Étienne;2;0;17;Division 1;2025/2026
11.03.26;FC Nantes;FC Fleury 91;2;0;17;Division 1;2025/2026
11.03.26;RC Lens;Montpellier HSC;2;1;17;Division 1;2025/2026
21.03.26;AS Saint-Étienne;Paris FC;0;3;18;Division 1;2025/2026
21.03.26;FC Fleury 91;OL Lyonnes;0;2;18;Division 1;2025/2026
22.03.26;Havre AC;Olympique Marseille;2;2;18;Division 1;2025/2026
22.03.26;RC Lens;Dijon FCO;0;1;18;Division 1;2025/2026
22.03.26;RC Strasbourg;FC Nantes;0;3;18;Division 1;2025/2026
22.03.26;Montpellier HSC;Paris Saint-Germain;2;3;18;Division 1;2025/2026
28.03.26;AS Saint-Étienne;RC Lens;2;1;19;Division 1;2025/2026
28.03.26;Dijon FCO;Havre AC;2;1;19;Division 1;2025/2026
28.03.26;Paris FC;FC Fleury 91;2;1;19;Division 1;2025/2026
28.03.26;RC Strasbourg;OL Lyonnes;2;2;19;Division 1;2025/2026
28.03.26;Olympique Marseille;Montpellier HSC;1;2;19;Division 1;2025/2026
28.03.26;FC Nantes;Paris Saint-Germain;1;2;19;Division 1;2025/2026
22.04.26;Paris Saint-Germain;AS Saint-Étienne;2;0;20;Division 1;2025/2026
22.04.26;Havre AC;RC Lens;0;1;20;Division 1;2025/2026
22.04.26;FC Fleury 91;RC Strasbourg;3;1;20;Division 1;2025/2026
22.04.26;Montpellier HSC;Paris FC;0;2;20;Division 1;2025/2026
22.04.26;OL Lyonnes;Dijon FCO;4;0;20;Division 1;2025/2026
22.04.26;Olympique Marseille;FC Nantes;0;2;20;Division 1;2025/2026
25.04.26;Dijon FCO;Paris FC;1;2;21;Division 1;2025/2026
25.04.26;FC Fleury 91;Paris Saint-Germain;0;2;21;Division 1;2025/2026
25.04.26;Montpellier HSC;AS Saint-Étienne;1;0;21;Division 1;2025/2026
25.04.26;RC Lens;Olympique Marseille;0;1;21;Division 1;2025/2026
25.04.26;RC Strasbourg;Havre AC;2;3;21;Division 1;2025/2026
29.04.26;FC Nantes;OL Lyonnes;1;1;21;Division 1;2025/2026
06.05.26;Havre AC;FC Nantes;3;3;22;Division 1;2025/2026
06.05.26;AS Saint-Étienne;FC Fleury 91;1;1;22;Division 1;2025/2026
06.05.26;Paris FC;RC Lens;6;2;22;Division 1;2025/2026
06.05.26;OL Lyonnes;Montpellier HSC;3;1;22;Division 1;2025/2026
06.05.26;Olympique Marseille;Dijon FCO;0;1;22;Division 1;2025/2026
06.05.26;Paris Saint-Germain;RC Strasbourg;2;0;22;Division 1;2025/2026
16.05.26;OL Lyonnes;FC Nantes;8;0;Halbfinale;Division 1 - Playoffs;2025/2026
16.05.26;Paris FC;Paris Saint-Germain;1;0;Halbfinale;Division 1 - Playoffs;2025/2026
29.05.26;OL Lyonnes;Paris FC;5;0;Finale;Division 1 - Playoffs;2025/2026`;

// Automatically load default embedded dataset or saved custom dataset on boot
document.addEventListener('DOMContentLoaded', () => {
    let dataToParse = DEFAULT_CSV_DATA;
    try {
        const savedData = localStorage.getItem('womens_football_csv_data');
        if (savedData && savedData.trim().length > 0) {
            dataToParse = savedData;
        }
    } catch (err) {
        console.warn('Konnte Daten nicht aus localStorage lesen:', err);
    }
    
    const rows = parseCSVText(dataToParse);
    if (rows && rows.length > 0) {
        RAW_DATA = rows;
        initializeDashboard(rows);
    }
});
