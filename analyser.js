const rp = require("request-promise")
const $ = require("cheerio")
const csv = require("csvtojson")
const fs = require("fs")

const url = "https://lol.gamepedia.com/LCS/2020_Season/Spring_Season"

let acronyms = {
  EG: "Evil Geniuses",
  "100": "100 Thieves",
  TSM: "Team SoloMid",
  C9: "Cloud9",
  IMT: "Immortals",
  GG: "Golden Guardians",
  DIG: "Dignitas",
  FLY: "FlyQuest",
  TL: "Team Liquid",
  CLG: "Counter Logic Gaming",
}

// let startElos = {
//   "Evil Geniuses": 1400,
//   "100 Thieves": 1480,
//   "Team SoloMid": 1520,
//   Cloud9: 1560,
//   Immortals: 1480,
//   "Golden Guardians": 1480,
//   Dignitas: 1500,
//   FlyQuest: 1420,
//   "Team Liquid": 1600,
//   "Counter Logic Gaming": 1560,
// }

// turns given csv file into an array of json objects
const parseCSV = async (filepath) => {
  let matchesArray = await (await csv().fromFile(filepath)).filter((row) => row.split === "Summer")
  LCSmatchesArray = matchesArray.filter((row) => row.league === "LCS")
  LECmatchesArray = matchesArray.filter((row) => row.league === "LEC")
  LCKmatchesArray = matchesArray.filter((row) => row.league === "LCK")
  // .filter((row) => row.position === "Team")
  // return [
  //   LCSmatchesArray.filter(
  //     (row) => new Date(row.date) < new Date("2020-04-02")
  //   ),
  //   LECmatchesArray.filter(
  //     (row) => new Date(row.date) < new Date("2020-04-02")
  //   ),
  //   LCKmatchesArray,
  // ]
  return [LCSmatchesArray, LECmatchesArray, LCKmatchesArray]
}

// given the raw array from the csv, returns object of teams
const fillTeams = (matchesArray) => {
  let teams = {}
  matchesArray
    .filter((row) => row.position === "team")
    .forEach((match) => {
      teams[match.team] = !(match.team in teams)
        ? {
            wins: 0,
            loses: 0,
            elo: 1500, // startElos[match.team],
            oldElo: 1500, // startElos[match.team],
            kills: 0,
            deaths: 0,
            gamesPlayed: 0,
          }
        : teams[match.team]
      // update wins/losses
      if (match.result === "1") {
        teams[match.team].wins += 1
      } else {
        teams[match.team].loses += 1
      }
      // updates kills/deaths
      teams[match.team].kills += Number(match.kills)
      teams[match.team].deaths += Number(match.deaths)
      teams[match.team].gamesPlayed += 1
    })
  return teams
}

// given the raw array from the csv, return obejct of matches
const fillMatches = (matchesArray) => {
  matches = {}
  matchesArray.forEach((match) => {
    match.date = new Date(match.date)
    matches[match.gameid] = !(match.gameid in matches)
      ? {
          "100": {},
          "200": {},
          "1": {},
          "2": {},
          "3": {},
          "4": {},
          "5": {},
          "6": {},
          "7": {},
          "8": {},
          "9": {},
          "10": {},
        }
      : matches[match.gameid]
    matches[match.gameid][match.playerid] = match
  })
  return matches
}

// input: two team objects
// output: chance of first team winning
const predict = (blue, red) => {
  return 1 / (1 + Math.pow(10, (red.elo - blue.elo) / 400))
}

// input: k value, match object, blue team object, red team object
// output: updated Elo values, predictions for match
const updateElo = (k, match, blue, red) => {
  let blueNewElo, blueOldElo, redNewElo, redOldElo
  blueOldElo = blue.elo
  redOldElo = red.elo

  let predBlue = predict(blue, red)
  let predRed = 1 - predBlue

  blueNewElo = Math.round(blueOldElo + k * (match["100"].result - predBlue))
  redNewElo = Math.round(redOldElo + k * (match["200"].result - predRed))

  return {
    blueNewElo: blueNewElo,
    blueOldElo: blueOldElo,
    redNewELo: redNewElo,
    redOldElo: redOldElo,
    predBlue: predBlue,
    predRed: predRed,
  }
}

// input: object of matches
// output: array of matches, sorted by date
const sortMatchesByDate = (matches) => {
  let sortable = []
  Object.keys(matches).forEach((match) => {
    sortable.push(matches[match])
  })
  sortable.sort((a, b) => Number(a["100"].date) - Number(b["100"].date))
  return sortable
}

// input: teams object, matches array
// output: teams object with updated Elo values, matches array with updated predictions
const updateTeamsAndMatches = (teams, matches) => {
  let updatedTeams = JSON.parse(JSON.stringify(teams))
  let updatedMatches = matches.map((match) => {
    values = updateElo(
      40,
      match,
      updatedTeams[match["100"].team],
      updatedTeams[match["200"].team]
    )
    updatedTeams[match["100"].team].elo = values.blueNewElo
    updatedTeams[match["100"].team].oldElo = values.blueOldElo
    updatedTeams[match["200"].team].elo = values.redNewELo
    updatedTeams[match["200"].team].oldElo = values.redOldElo
    match["100"]["prediction"] = values.predBlue
    match["200"]["prediction"] = values.predRed
    return match
  })
  return [updatedTeams, updatedMatches]
}

const getFixtures = async (week) => {
  const url = "https://lol.gamepedia.com/LCS/2020_Season/Spring_Season"
  let html = await rp(url)
  let blueTeams = $(`.ml-w${week} .matchlist-team1`, html)
    .toArray()
    .map((x) => $(x).text())
  let redTeams = $(`.ml-w${week} .matchlist-team2`, html)
    .toArray()
    .map((x) => $(x).text())
  let counter = -1
  let fixtures = blueTeams.map((blueTeam) => {
    counter++
    return {
      blueTeam: acronyms[blueTeam],
      redTeam: acronyms[redTeams[counter]],
    }
  })
  return fixtures
}

const main = async () => {
  const filepath = "./in/2020.csv"
  let [LCSmatchesArray, LECmatchesArray, LCKmatchesArray] = await parseCSV(
    filepath
  )

  let [LCSteams, LCSmatches] = updateTeamsAndMatches(
    fillTeams(LCSmatchesArray),
    sortMatchesByDate(fillMatches(LCSmatchesArray))
  )
  let [LECteams, LECmatches] = updateTeamsAndMatches(
    fillTeams(LECmatchesArray),
    sortMatchesByDate(fillMatches(LECmatchesArray))
  )
  let [LCKteams, LCKmatches] = updateTeamsAndMatches(
    fillTeams(LCKmatchesArray),
    sortMatchesByDate(fillMatches(LCKmatchesArray))
  )

  let fixtures = await getFixtures(9)
  console.log(LCKteams)

  fs.writeFileSync("./out/summer/LCSteams.json", JSON.stringify(LCSteams))
  fs.writeFileSync("./out/summer/LCSmatches.json", JSON.stringify(LCSmatches))
  fs.writeFileSync("./out/summer/LECteams.json", JSON.stringify(LECteams))
  fs.writeFileSync("./out/summer/LECmatches.json", JSON.stringify(LECmatches))
  fs.writeFileSync("./out/summer/LCKteams.json", JSON.stringify(LCKteams))
  fs.writeFileSync("./out/summer/LCKmatches.json", JSON.stringify(LCKmatches))
}

main()
