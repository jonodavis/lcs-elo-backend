const rp = require("request-promise")
const $ = require("cheerio")
const csv = require("csvtojson")
const fs = require("fs")

let acronyms = {
  "EG": "Evil Geniuses",
  "100": "100 Thieves",
  "TSM": "Team SoloMid",
  "C9": "Cloud9",
  "IMT": "Immortals",
  "GG": "Golden Guardians",
  "DIG": "Dignitas",
  "FLY": "FlyQuest",
  "TL": "Team Liquid",
  "CLG": "Counter Logic Gaming",
}

// turns given csv file into an array of json objects
const parseCSV = async (filepath) => {
  let matchesArray = await (await csv().fromFile(filepath))
  LCSSpringMatchesArray = matchesArray.filter((row) => row.league === "LCS" && row.split === "Spring")
  LECSpringMatchesArray = matchesArray.filter((row) => row.league === "LEC" && row.split === "Spring")
  LCKSpringMatchesArray = matchesArray.filter((row) => row.league === "LCK" && row.split === "Spring")
  LCSSummerMatchesArray = matchesArray.filter((row) => row.league === "LCS" && row.split === "Summer")
  LECSummerMatchesArray = matchesArray.filter((row) => row.league === "LEC" && row.split === "Summer")
  LCKSummerMatchesArray = matchesArray.filter((row) => row.league === "LCK" && row.split === "Summer")
  return [LCSSpringMatchesArray, LECSpringMatchesArray, LCKSpringMatchesArray, LCSSummerMatchesArray, LECSummerMatchesArray, LCKSummerMatchesArray]
}

// given the raw array from the csv, returns object of teams
const fillTeams = (matchesArray, previousSplit = null) => {
  let teams = {}
  matchesArray
    .filter((row) => row.position === "team")
    .forEach((match) => {
      teams[match.team] = !(match.team in teams)
        ? {
          wins: 0,
          loses: 0,
          elo: previousSplit ? Object.keys(previousSplit).includes(match.team) ? ((0.75 * previousSplit[match.team].elo) + (0.25 * 1500)) : 1500 : 1500,
          oldElo: previousSplit ? Object.keys(previousSplit).includes(match.team) ? ((0.75 * previousSplit[match.team].elo) + (0.25 * 1500)) : 1500 : 1500,
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
  const url = "https://lol.gamepedia.com/LCS/2020_Season/Summer_Season"
  let html = await rp(url)
  let blueTeams = $(`.ml-w${week} .matchlist-team1`, html)
    .toArray()
    .map((x) => $(x).text().trim().slice(0, -2))
  let redTeams = $(`.ml-w${week} .matchlist-team2`, html)
    .toArray()
    .map((x) => $(x).text().trim().slice(2))
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
  let [LCSSpringMatchesArray,
    LECSpringMatchesArray,
    LCKSpringMatchesArray,
    LCSSummerMatchesArray,
    LECSummerMatchesArray,
    LCKSummerMatchesArray] = await parseCSV(filepath)

  let [LCSSpringTeams, LCSSpringMatches] = updateTeamsAndMatches(
    fillTeams(LCSSpringMatchesArray),
    sortMatchesByDate(fillMatches(LCSSpringMatchesArray))
  )
  let [LECSpringTeams, LECSpringmMatches] = updateTeamsAndMatches(
    fillTeams(LECSpringMatchesArray),
    sortMatchesByDate(fillMatches(LECSpringMatchesArray))
  )
  let [LCKSpringTeams, LCKSpringMatches] = updateTeamsAndMatches(
    fillTeams(LCKSpringMatchesArray),
    sortMatchesByDate(fillMatches(LCKSpringMatchesArray))
  )
  let [LCSSummerTeams, LCSSummerMatches] = updateTeamsAndMatches(
    fillTeams(LCSSummerMatchesArray, LCSSpringTeams),
    sortMatchesByDate(fillMatches(LCSSummerMatchesArray))
  )
  let [LECSummerTeams, LECSummermMatches] = updateTeamsAndMatches(
    fillTeams(LECSummerMatchesArray, LECSpringTeams),
    sortMatchesByDate(fillMatches(LECSummerMatchesArray))
  )
  let [LCKSummerTeams, LCKSummerMatches] = updateTeamsAndMatches(
    fillTeams(LCKSummerMatchesArray, LCKSpringTeams),
    sortMatchesByDate(fillMatches(LCKSummerMatchesArray))
  )

  let fixtures = await getFixtures(8)
  // console.log("memes")

  // spring split
  fs.writeFileSync("./out/LCSteams.json", JSON.stringify(LCSSpringTeams))
  fs.writeFileSync("./out/LCSmatches.json", JSON.stringify(LCSSpringMatches))
  fs.writeFileSync("./out/LECteams.json", JSON.stringify(LECSpringTeams))
  fs.writeFileSync("./out/LECmatches.json", JSON.stringify(LECSpringmMatches))
  fs.writeFileSync("./out/LCKteams.json", JSON.stringify(LCKSpringTeams))
  fs.writeFileSync("./out/LCKmatches.json", JSON.stringify(LCKSpringMatches))
  // summer split
  fs.writeFileSync("./out/summer/LCSteams.json", JSON.stringify(LCSSummerTeams))
  fs.writeFileSync("./out/summer/LCSmatches.json", JSON.stringify(LCSSummerMatches))
  fs.writeFileSync("./out/summer/LECteams.json", JSON.stringify(LECSummerTeams))
  fs.writeFileSync("./out/summer/LECmatches.json", JSON.stringify(LECSummermMatches))
  fs.writeFileSync("./out/summer/LCKteams.json", JSON.stringify(LCKSummerTeams))
  fs.writeFileSync("./out/summer/LCKmatches.json", JSON.stringify(LCKSummerMatches))
}

main()
