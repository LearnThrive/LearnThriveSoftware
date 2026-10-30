/**
 * The scripted interfaces the mock provider writes (ASSISTANT_PROVIDER=mock; development and tests only). They stand in for Beam so the interface path,
 * the page and the browser tests can be exercised without a model or a key. They prove the CODE (validation, repair, streaming, rendering, interaction),
 * never that Beam can write valid interfaces: that is measured separately with a real key (docs/OPENUI.md).
 *
 * The student's message steers it with a marker, the way the text mock does: [ui:invalid] is never valid (the fallback), [ui:fixable] is invalid once and
 * valid after the repair request, [ui:truncated] is cut off, [ui:script] carries markup, [ui:slow] streams slowly (to test Stop). Otherwise the words in
 * the message choose a kind.
 */
const GRAPH = `root = Answer([intro, sl, graph, note, next], "Stretching y = x squared")
intro = Text("The graph of $y = a x^2$ is a parabola. The number $a$ stretches it up and down. Move the slider and watch the curve.")
$a = 1
sl = Slider("a", "Value of a", -3, 3, 0.5, $a)
graph = FunctionGraph([GraphFunction("a*x^2", "y = a x²")], -4, 4, [Param("a", $a)], "y = a x²", -10, 10, [GraphPoint(0, 0, "turning point")])
note = Callout("When a is negative the parabola turns upside down.", "tip")
next = FollowUps(["Show me y = x² + c", "Quiz me on parabolas"])`;

const QUIZ = `root = Answer([intro, quiz, next], "Photosynthesis quiz")
intro = Text("Answer each question, then press Check. Use the hint if you are stuck.")
quiz = Quiz([q1, q2, q3], "Check what you know")
q1 = MultipleChoice("Which gas do plants take in for photosynthesis?", ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"], 1, "Think about what plants build glucose from.", "Plants take in carbon dioxide and give out oxygen.")
q2 = ShortAnswer("Which green pigment absorbs the light?", ["chlorophyll"], "It is the reason leaves are green.", "Chlorophyll absorbs light energy so it can be used to make glucose.")
q3 = MultipleChoice("What is 6 × 7?", ["36", "42", "48"], 1, "Count in sixes.", "6 × 7 = 42.")
next = FollowUps(["Explain the word equation", "Make flashcards on this"])`;

/** The same quiz with a wrong key on the arithmetic question: the validator must refuse it. */
const QUIZ_BAD_KEY = QUIZ.replace('["36", "42", "48"], 1, "Count in sixes."', '["36", "42", "48"], 0, "Count in sixes."');

const FLASHCARDS = `root = Answer([intro, deck, next], "Photosynthesis flashcards")
intro = Text("Flip each card to check yourself, then move to the next one.")
deck = Flashcards([c1, c2, c3], "Photosynthesis")
c1 = Flashcard("What does photosynthesis make?", "Glucose and oxygen.")
c2 = Flashcard("What does a plant need for photosynthesis?", "Carbon dioxide, water and light.")
c3 = Flashcard("Where does it happen?", "In the chloroplasts of plant cells.")
next = FollowUps(["Quiz me on photosynthesis"])`;

const DIAGRAM = `root = Answer([intro, process, eq, next], "Photosynthesis")
intro = Text("Photosynthesis turns light, water and carbon dioxide into glucose and oxygen.")
process = ProcessDiagram([s1, s2], "How it works")
s1 = ProcessStage("Light is absorbed", "Chlorophyll in the chloroplasts absorbs light energy.", ["light", "water"], ["energy"])
s2 = ProcessStage("Glucose is made", "The energy is used to build glucose from carbon dioxide and water.", ["carbon dioxide", "energy"], ["glucose", "oxygen"])
eq = Reaction(["6CO2", "6H2O"], ["C6H12O6", "6O2"], "light, chlorophyll", "Symbol equation")
next = FollowUps(["Quiz me on photosynthesis"])`;

const COMPARISON = `root = Answer([intro, compare, q1, q2, next], "Comparing the quotations")
intro = Text("Here are two quotations and how they compare.")
compare = Comparison(["Quotation A", "Quotation B"], [r1], "Side by side")
r1 = ComparisonRow("Technique", ["Imperative verb.", "Direct address."])
q1 = QuoteCard("Out, damned spot!", "Macbeth", "Lady Macbeth", "Act 5, Scene 1", "Imperative", "A command to a stain only she can see.")
q2 = QuoteCard("To thine own self be true", "Macbeth", "Macbeth", "Act 1", "Advice", "A line the interface wrongly places in this play.")
next = FollowUps(["Help me plan an essay"])`;

const WORKED = `root = Answer([intro, steps, next], "Solving 2x + 7 = 19")
intro = Text("Reveal each step when you are ready.")
steps = SolutionSteps([a, b, c], "12 / 2 = 6", "Solve 2x + 7 = 19")
a = SolutionStep("Take 7 from both sides.", "2x = 12", "What undoes adding 7?")
b = SolutionStep("Divide both sides by 2.", "x = 6")
c = SolutionStep("Check by substituting back.", "2(6) + 7 = 19")
next = FollowUps(["Give me a similar question"])`;

const TIMELINE = `root = Answer([intro, line, next], "Key events")
intro = Text("The events in order.")
line = Timeline([e1, e2], "Timeline")
e1 = TimelineEvent("1914", "The war begins", "Britain declares war in August.")
e2 = TimelineEvent("1918", "The war ends", "An armistice is signed in November.")
next = FollowUps(["Quiz me on these events"])`;

const ORGANISER = `root = Answer([intro, sheet, list, next], "Revision summary")
intro = Text("A one-page summary and a checklist.")
sheet = KnowledgeOrganiser([s1, s2], "Photosynthesis")
s1 = OrganiserSection("Inputs", ["Carbon dioxide", "Water", "Light"])
s2 = OrganiserSection("Outputs", ["Glucose", "Oxygen"])
list = Checklist(["I can write the word equation", "I can name the inputs and outputs"], "Can you?")
next = FollowUps(["Quiz me on photosynthesis"])`;

const OPEN = `root = Answer([intro, open, next], "Write your own")
intro = Text("This one needs your own words.")
open = OpenResponse("Explain why plants need light for photosynthesis.", "Mention energy and chlorophyll.")
next = FollowUps(["Show me the model answer"])`;

const INVALID = `root = Answer([a, b])
a = Text("An introduction that is long enough to be a real sentence.")
b = NotARealComponent("this component does not exist")`;

const TRUNCATED = `root = Answer([a])
a = Text("An introduction that starts but never finishes because the reply was cut`;

/** An interface that tries to send the student somewhere: an action no component offers. It must never reach the page. */
const ACTION = `root = Answer([a, b])
a = Text("An introduction that is long enough to be a real sentence here.")
b = Button("Open it", @OpenUrl("https://evil.example/steal"))`;

const SCRIPT = `root = Answer([a])
a = Text("Click <script>alert(1)</script> to continue with the interface please")`;

export function interfaceScript(last: string, repairing: boolean): string {
  if (last.includes("[ui:invalid]")) return INVALID;
  if (last.includes("[ui:truncated]")) return TRUNCATED;
  if (last.includes("[ui:script]")) return SCRIPT;
  if (last.includes("[ui:action]")) return ACTION;
  if (last.includes("[ui:fixable]")) return repairing ? QUIZ : QUIZ_BAD_KEY;
  if (last.includes("[ui:badkey]")) return QUIZ_BAD_KEY;
  const text = last.toLowerCase();
  if (/flash ?cards?/.test(text)) return FLASHCARDS;
  if (/\bquiz\b|test me|multiple choice/.test(text)) return QUIZ;
  if (/\bplot\b|\bgraph\b|parabola/.test(text)) return GRAPH;
  if (/step[- ]by[- ]step|reveal/.test(text)) return WORKED;
  if (/compare|side by side|quotation/.test(text)) return COMPARISON;
  if (/timeline/.test(text)) return TIMELINE;
  if (/organi[sz]er|checklist|revision (sheet|summary)/.test(text)) return ORGANISER;
  if (/open (question|response)|own words/.test(text)) return OPEN;
  return DIAGRAM;
}
