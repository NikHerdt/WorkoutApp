/**
 * Substitution Option 1 and Option 2 from the program spreadsheet
 * (The_Ultimate_Push_Pull_Legs_System_-_5x copy.xlsx), keyed by exercise name in seed data.
 */
export type ProgramSubstitution = {
  option1: string | null;
  option2: string | null;
};

const PROGRAM_SUBSTITUTIONS: Record<string, ProgramSubstitution> = {
  "1-Arm Half Kneeling Lat Pulldown": { option1: "1-Arm Lat Pull-In", option2: "Cable Lat Pullover" },
  "A1. Bottom-Half DB Lat Pullover": { option1: "Cable Lat Pullover", option2: "1-Arm Lat Pull-In" },
  "A1. Press-Around": { option1: "DB Flye", option2: "Deficit Push Up" },
  "A1: Lean-In DB Lateral Raise": { option1: "Constant-Tension Cable Lateral Raise", option2: "Constant-Tension Machine Lateral Raise" },
  "A2. Lat Static Stretch": { option1: null, option2: null },
  "A2. Pec Static Stretch": { option1: null, option2: null },
  "A2: Bicep Static Stretch": { option1: null, option2: null },
  "A2: Side Delt Static Stretch": { option1: null, option2: null },
  "Alternating DB Curl": { option1: "EZ Bar Curl", option2: "Cable Curl" },
  "Barbell RDL": { option1: "DB RDL", option2: "45\u00b0 Hyperextension" },
  "Bayesian Cable Curl": { option1: "DB Incline Curl", option2: "DB Curl" },
  "Bench Press": { option1: "DB Bench Press", option2: "Machine Chest Press" },
  "Bench Press (Back Off AMRAP)": { option1: "DB Bench Press", option2: "Machine Chest Press" },
  "Bench Press (Top Set)": { option1: "DB Bench Press", option2: "Machine Chest Press" },
  "Bottom-Half Preacher Curl": { option1: "Bottom-Half Spider Curl", option2: "Bottom-Half Bayesian Curl" },
  "Cable Crossover Ladder": { option1: "Flat-To-Incline DB Flye", option2: "Pec Deck" },
  "Cable Crunch": { option1: "Plate-Weighted Crunch", option2: "Machine Crunch" },
  "Cable Lateral Raise (Eccentric + Constant Tension)": { option1: "DB Lateral Raise", option2: "Machine Lateral Raise" },
  "Cable Shrug-In": { option1: "DB Shrug", option2: "Plate Shrug" },
  "Cable Triceps Kickback": { option1: "DB Triceps Kickback", option2: "Triceps Pressdown" },
  "Close-Grip Barbell Incline Press": { option1: "Close-Grip DB Incline Press", option2: "Close-Grip Machine Press" },
  "Close-Grip Seated Cable Row": { option1: "T-Bar Row", option2: "Incline Chest-Supported DB Row" },
  "Corpse Crunch": { option1: "Plate-Weighted Crunch", option2: "Cable Crunch" },
  "Cross-Body Cable Y-Raise": { option1: "DB Lateral Raise", option2: "Machine Lateral Raise" },
  "Deadlift": { option1: "Trap Bar Deadlift", option2: "Barbell Hip Thrust" },
  "Decline Plate-Weighted Crunch": { option1: "Cable Crunch", option2: "Machine Crunch" },
  "Diamond Pushup": { option1: "Close-Grip Push Up", option2: "Kneeling Modified Push Up" },
  "Dumbbell RDL": { option1: "Barbell RDL", option2: "45\u00b0 Hyperextension" },
  "Dumbbell Walking Lunge": { option1: "DB Step-Up", option2: "Goblet Squat" },
  "EZ-Bar Curl": { option1: "DB Curl", option2: "Cable Curl" },
  "EZ-Bar Curl (Heavy)": { option1: "DB Curl", option2: "Cable Curl" },
  "Egyptian Cable Lateral Raise": { option1: "DB Lateral Raise", option2: "Machine Lateral Raise" },
  "Front Squat": { option1: "High-Bar Box Squat", option2: "Goblet Squat" },
  "Glute Ham Raise": { option1: "Nordic Ham Curl", option2: "Lying Leg Curl" },
  "Hack Squat": { option1: "Machine Squat", option2: "Bulgarian Split Squat" },
  "Hammer Cheat Curl": { option1: "Inverse Zottman Curl", option2: "DB Curl" },
  "High-Incline Smith Machine Press": { option1: "Incline DB Press", option2: "Incline Machine Press" },
  "Kroc Row": { option1: "Single-Arm DB Row", option2: "Meadows Row" },
  "LLPT Plank": { option1: "Ab Wheel Rollout", option2: "Plank" },
  "Larsen Press": { option1: "DB Bench Press (No Leg Drive)", option2: "Machine Chest Press (No Leg Drive)" },
  "Lat Pulldown (Failure + Dropset)": { option1: "Machine Pulldown", option2: "Pull-Up" },
  "Lat Pulldown (Feeder Sets)": { option1: "Machine Pulldown", option2: "Pull-Up" },
  "Leg Extension": { option1: "DB Step-Up", option2: "Goblet Squat" },
  "Leg Press": { option1: "Goblet Squat", option2: "Walking Lunge" },
  "Leg Press Toe Press": { option1: "Seated Calf Raise", option2: "Standing Calf Raise" },
  "Low Incline DB Press": { option1: "Low Incline Machine Press", option2: "Low Incline Smith Machine Press" },
  "Lying Leg Curl": { option1: "Seated Leg Curl", option2: "Nordic Ham Curl" },
  "Machine Lateral Raise": { option1: "DB Lateral Raise", option2: "Cable Lateral Raise" },
  "Machine Low Row": { option1: "Helms Row", option2: "Incline Chest-Supported DB Row" },
  "Machine Shoulder Press": { option1: "DB Shoulder Press", option2: "Standing DB Arnold Press" },
  "Med-Ball Close Grip Push Up": { option1: "Close-Grip Push Up", option2: "Kneeling Modified Push Up" },
  "N1-Style Cross-Body Bicep Curl": { option1: "DB Incline Curl", option2: "DB Curl" },
  "N1-Style Cross-Body Triceps Extension": { option1: "Single-Arm Tricep Pressdown", option2: "Single-Arm Cable Tricep Kickback" },
  "Neutral-Grip Lat Pulldown": { option1: "Neutral-Grip Pull-Up", option2: "Machine Pulldown" },
  "Omni-Direction Face Pull": { option1: "Reverse Cable Flye", option2: "Bent-Over Reverse DB Flye" },
  "Omni-Grip Lat Pulldown": { option1: "Omni-Grip Pull-Up", option2: "Chin-Up" },
  "Omni-Grip Machine Chest-Supported Row": { option1: "Incline Chest-Supported DB Row", option2: "Cable Seated Row" },
  "Overhead Cable Triceps Extension": { option1: "DB Floor Skull Crusher", option2: "DB French Press" },
  "Overhead Triceps Extension": { option1: "DB Floor Skull Crusher", option2: "DB French Press" },
  "Pause Squat (Back Off)": { option1: "Pause Hack Squat", option2: "Pause DB Bulgarian Split Squat" },
  "Pendlay Row": { option1: "Meadows Row", option2: "Single-Arm Row" },
  "Pull-Up": { option1: "Lat Pulldown", option2: "Machine Pulldown" },
  "Pull-Up (Cluster Sets)": { option1: "Lat Pulldown", option2: "Machine Pulldown" },
  "Reverse Pec Deck": { option1: "Reverse Cable Flye", option2: "Bent-Over Reverse DB Flye" },
  "Roman Chair Leg Raise": { option1: "Hanging Leg Raise", option2: "Reverse Crunch" },
  "Seated Calf Raise": { option1: "Standing Calf Raise", option2: "Leg Press Toe Press" },
  "Seated DB Shoulder Press": { option1: "Machine Shoulder Press", option2: "Standing DB Arnold Press" },
  "Seated Leg Curl": { option1: "Lying Leg Curl", option2: "Nordic Ham Curl" },
  "Slow Seated Leg Curl (3s up, 3s down)": { option1: "Lying Leg Curl", option2: "Nordic Ham Curl" },
  "Slow-Eccentric Leg Extension": { option1: "DB Step-Up", option2: "Goblet Squat" },
  "Squat": { option1: "Hack Squat", option2: "DB Bulgarian Split Squat" },
  "Squat or Machine Squat": { option1: "Machine Squat", option2: "Bulgarian Split Squat" },
  "Standing Calf Raise": { option1: "Seated Calf Raise", option2: "Leg Press Toe Press" },
  "Standing Dumbbell Arnold Press": { option1: "Seated DB Shoulder Press", option2: "Machine Shoulder Press" },
  "Stiff-Leg Deadlift": { option1: "Barbell RDL", option2: "DB RDL" },
  "Triceps Pressdown": { option1: "Cable Triceps Kickback", option2: "DB Triceps Kickback" },
  "Triceps Pressdown + Overhead Extension": { option1: "Triceps Pressdown (12-15 reps)", option2: "DB Skull Crusher (12-15 reps)" },
  "Walking Lunge": { option1: "DB Step-Up", option2: "Goblet Squat" },
  "Weighted Dip": { option1: "Machine Chest Press", option2: "DB Bench Press" },
  "Wide-Grip Cable Row (Cluster Sets)": { option1: "Wide-Grip Machine Row", option2: "Wide-Grip T-Bar Row" },
  "Wide-Grip Pull-Up": { option1: "Wide-Grip Lat Pulldown", option2: "Machine Pulldown" },
};

function normProgramKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getProgramSubstitutions(exerciseName: string): ProgramSubstitution | null {
  const direct = PROGRAM_SUBSTITUTIONS[exerciseName];
  if (direct) return direct;
  const n = normProgramKey(exerciseName);
  for (const [k, v] of Object.entries(PROGRAM_SUBSTITUTIONS)) {
    if (normProgramKey(k) === n) return v;
  }
  return null;
}
