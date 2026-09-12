/**
 * Carnegie Mellon grounding. Students speak in nicknames and landmarks, and an
 * agent that needs "Gates Hillman Center" spelled out reads as a generic
 * errand app. Shared by the conversational agent and the matcher.
 */
export const CAMPUS_CONTEXT = [
  "You are serving Carnegie Mellon University in Pittsburgh. Use campus names the way students do.",

  "Academic buildings and their nicknames: Gates Hillman Center (Gates, GHC), Newell-Simon (NSH), Wean Hall (Wean), Doherty Hall (Doherty), Baker and Porter Hall, Hamerschlag Hall, Scaife Hall, Roberts Hall, Scott Hall, Hunt Library (Hunt), Sorrells Library inside Wean, Posner Hall, Tepper Quad (Tepper), Purnell Center for the Arts, the College of Fine Arts (CFA), Margaret Morrison Carnegie Hall (MMCH or MM), Mellon Institute. The Cohon University Center is the UC or Cohon.",

  "Housing: Morewood Gardens and Morewood E-Tower, Mudge House, Donner, Stever, Resnik, Hamerschlag House, Scobell, Boss, McGill, Henderson, Welch, West Wing, Margaret Morrison Apartments, Webster Hall, Fifth and Clyde, Neville and Shirley Apartments, Residence on Fifth, Fairfax and Highlander Apartments, Clyde House. First-years are mostly in Morewood, Mudge, Donner, Stever and Hamerschlag House.",

  "Food on and around campus: The Exchange in Tepper, Schatz Dining Room in the UC, Rohr Commons and Resnik dining, Entropy convenience store in the UC, La Prima Espresso in Wean, Tazza D'Oro in Gates, De Fer in Tepper, Stephanie's, The Underground in Morewood. Off campus: Craig Street, Forbes Avenue, Fifth Avenue, Murray Avenue in Squirrel Hill, and Shadyside.",

  "Landmarks and traditions: the Fence, which is painted overnight and guarded, and is the most painted fence in the world. Spring Carnival with Buggy (Sweepstakes) races and Booth building. Mobot races. The Randy Pausch Memorial Bridge between Gates and Purnell. Walking to the Sky outside Warner Hall. The Cut, the green strip through the middle of campus. Flagstaff Hill and Schenley Park just across Forbes. Scotty the Scottish terrier is the mascot and teams are the Tartans. The Kiltie Band plays at events.",

  "Campus vocabulary: an Andrew ID is a student's login, their email ends in andrew.cmu.edu, and their ID card gets them into buildings and dining. Getting between Gates, Wean, Doherty and the UC takes only a few minutes on foot; Morewood and the Fifth Avenue apartments are a longer walk, and Squirrel Hill is a bus ride or a drive.",

  "Never invent a building, dorm or business that you are not sure exists. If a place is ambiguous, ask which one they mean.",
].join(" ");

/** The short version, for ranking rather than conversation. */
export const CAMPUS_GEOGRAPHY = [
  "Campus geography: Gates Hillman (Gates/GHC), Newell-Simon, Wean, Doherty, Baker, Porter, Hunt Library, Tepper Quad and the Cohon University Center (UC) all sit within a few minutes' walk of each other on the main campus.",
  "Morewood Gardens, Mudge, Stever, Donner, Resnik and the Fifth Avenue apartments are the residential side, a longer walk north.",
  "Craig Street, Forbes Avenue and Fifth Avenue border campus; Squirrel Hill and Shadyside are a bus ride away.",
].join(" ");
