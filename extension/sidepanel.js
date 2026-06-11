// Side panel — reads last ATS status + auth/resume/plan from chrome.storage.
const KEY_STATUS = "aplyer.ats_status.v1";
const KEY_QUESTION = "aplyer.selected_question.v1";
const KEY_SESSION = "aplyer.session.v1";

const $ = (id) => document.getElementById(id);

function render(state) {
  const { status, question, session, profile } = state;
  // Platform pill
  if (status?.platform) {
    $("platform-pill").textContent = `${status.platform} Detected`;
    $("platform-pill").classList.add("pill-green");
  } else {
    $("platform-pill").textContent = "No ATS";
    $("platform-pill").classList.remove("pill-green");
  }
  $("s-platform").textContent = status?.platform || "Not detected";
  $("s-count").textContent = String(status?.questionsCount || 0);
  $("s-conn").textContent = session ? "Signed in" : "Not signed in";
  $("s-resume").textContent = profile?.resume || (session ? "Open dashboard" : "—");
  $("s-plan").textContent = profile?.plan || (session ? "Free" : "—");

  if (question) {
    $("question-card").style.display = "";
    $("q-text").textContent = question.questionText;
    $("q-meta").textContent = `id: ${question.questionId}  ·  type: ${question.questionType}`;
  }

  if (status?.questions?.length) {
    $("questions-card").style.display = "";
    const ol = $("q-list");
    ol.innerHTML = "";
    for (const q of status.questions) {
      const li = document.createElement("li");
      li.textContent = q.questionText;
      ol.appendChild(li);
    }
  }
}

async function load() {
  const data = await chrome.storage.local.get([KEY_STATUS, KEY_QUESTION, KEY_SESSION]);
  render({
    status: data[KEY_STATUS] || null,
    question: data[KEY_QUESTION] || null,
    session: data[KEY_SESSION] || null,
    profile: null,
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[KEY_STATUS] || changes[KEY_QUESTION] || changes[KEY_SESSION]) load();
});

load();
