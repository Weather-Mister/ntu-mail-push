export async function fetchCoolFeed(input,fetcher=fetch) {
  let url=new URL(input);
  for(let redirects=0;redirects<4;redirects++) {
    if(url.protocol!=='https:'||url.hostname!=='cool.ntu.edu.tw'||url.username||url.password||url.port&&url.port!=='443')throw new Error('Untrusted calendar destination');
    const response=await fetcher(url.href,{headers:{accept:'text/calendar'},redirect:'manual',signal:AbortSignal.timeout(12000)});
    if(![301,302,303,307,308].includes(response.status))return response;
    const location=response.headers.get('Location');await response.body?.cancel();
    if(!location)throw new Error('Calendar redirect missing');url=new URL(location,url);
  }
  throw new Error('Too many calendar redirects');
}

function unfoldIcs(text) {
  return text.replace(/\r?\n[ \t]/g, "");
}

function decodeIcsText(value = "") {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcsDate(value, params = "") {
  if (!value) return null;
  const allDay = /VALUE=DATE/i.test(params) || /^\d{8}$/.test(value);
  if (allDay) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    const date = `${y}-${m}-${d}`;
    return { allDay: true, date, dueAt: `${date}T23:59:59+08:00` };
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s = "00", z] = match;
  const base = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  return {
    allDay: false,
    date: `${y}-${mo}-${d}`,
    dueAt: z ? new Date(`${base}Z`).toISOString() : `${base}+08:00`
  };
}

function directAssignmentUrl(event) {
  const assignmentId = event.uid?.match(/^event-assignment-(\d+)$/)?.[1];
  const courseId = event.url?.match(/[?&]include_contexts=course_(\d+)/)?.[1];
  if (assignmentId && courseId) {
    return `https://cool.ntu.edu.tw/courses/${courseId}/assignments/${assignmentId}`;
  }
  return event.url || "";
}

export function parseCoolFeed(text) {
  const lines = unfoldIcs(text).split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = {}; continue; }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [rawName, ...paramParts] = left.split(";");
    const name = rawName.toUpperCase();
    const params = paramParts.join(";");

    if (name === "UID") current.uid = value;
    if (name === "SUMMARY") current.summary = decodeIcsText(value);
    if (name === "DESCRIPTION") current.description = decodeIcsText(value);
    if (name === "URL") current.url = decodeIcsText(value);
    if (name === "DTSTART") current.start = parseIcsDate(value, params);
  }

  return events
    .filter(event => event.uid?.startsWith("event-assignment-") && event.start && event.summary)
    .map(event => {
      const courseMatch = event.summary.match(/\s*\[([^\]]+)\]\s*$/);
      const course = courseMatch ? courseMatch[1].trim() : "NTU COOL";
      const title = courseMatch
        ? event.summary.slice(0, courseMatch.index).trim()
        : event.summary.trim();

      return {
        id: event.uid,
        title,
        course,
        description: event.description || "",
        url: directAssignmentUrl(event),
        date: event.start.date,
        dueAt: event.start.dueAt,
        allDay: event.start.allDay
      };
    })
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
}

