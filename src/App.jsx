import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

const STORAGE_KEY = "semester-study-hub-v3";
const REVIEW_STORAGE_KEY = "semester-review-hub-v1";
const LEGACY_KEYS = ["semester-study-hub-v2", "semester-study-hub-v1"];
const DB_NAME = "semester-study-hub-db";
const STORE_NAME = "course-files";
const AUTH_EMAIL_DOMAIN = "users.semester-study-hub.local";
const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9_.-]{2,31})$/;
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TERM_START = "2026-04-13";
const TERM_END = "2026-07-17";
const DAY_ORDER = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
const FILE_CATEGORIES = ["课堂文件", "笔记", "作业", "其他"];
const TIME_RANGE_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_BUCKET = "study-files";

const STARTER_COURSES = [
  { name: "Multimediaprogrammierung", kind: "Vorlesung", weekday: "Montag", time: "10:00-12:00", room: "S 002 · Schellingstr. 3" },
  { name: "Statistik II", kind: "Vorlesung", weekday: "Montag", time: "12:00-14:00", room: "A 240 · Geschw.-Scholl-Pl. 1" },
  { name: "Algorithmen und Datenstrukturen", kind: "Vorlesung", weekday: "Dienstag", time: "08:00-11:00", room: "Große Aula (E120)" },
  { name: "Logik und Diskrete Strukturen", kind: "Vorlesung", weekday: "Dienstag", time: "11:00-14:00", room: "Große Aula (E120)" },
  { name: "Formale Sprachen und Komplexität", kind: "Vorlesung", weekday: "Dienstag", time: "14:00-17:00", room: "A 240" },
  { name: "Grundlagen des Maschinellen Lernens", kind: "Vorlesung", weekday: "Dienstag", time: "14:00-16:00", room: "M 110" },
  { name: "Statistik II", kind: "Übung", weekday: "Dienstag", time: "16:00-18:00", room: "E 004" },
  { name: "Implementation of Database Systems", kind: "Vorlesung", weekday: "Mittwoch", time: "09:00-12:00", room: "211 · Amalienstr. 73A" },
  { name: "Einführung in das maschinelle Lernen", kind: "Vorlesung", weekday: "Mittwoch", time: "10:00-12:00", room: "S 006 · Schellingstr. 3" },
  { name: "Statistik II", kind: "Übung", weekday: "Mittwoch", time: "14:00-16:00", room: "E 004" },
  { name: "Fortgeschrittene Statistische Software", kind: "Vorlesung", weekday: "Donnerstag", time: "10:00-12:00", room: "S 001 · Schellingstr. 3" },
  { name: "Statistik II", kind: "Vorlesung", weekday: "Donnerstag", time: "12:00-14:00", room: "A 240" },
  { name: "Rechnerarchitektur", kind: "Vorlesung", weekday: "Donnerstag", time: "14:00-17:00", room: "B 201" },
  { name: "Rechnernetze und Verteilte Systeme", kind: "Vorlesung", weekday: "Freitag", time: "09:00-12:00", room: "B 001 · Oettingenstr. 67" },
];

const EMPTY_SCHEDULE_ENTRY = {
  weekday: "Montag",
  time: "",
};

const EMPTY_COURSE_FORM = {
  name: "",
  teacher: "",
  kind: "Vorlesung",
  scheduleEntries: [{ ...EMPTY_SCHEDULE_ENTRY }],
  room: "",
};

const EMPTY_REVIEW_FORM = {
  sourceCourseId: "",
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function classNames(...arr) {
  return arr.filter(Boolean).join(" ");
}

let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("Turnstile 只能在浏览器里使用。"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.turnstile), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Turnstile 脚本加载失败。")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error("Turnstile 脚本加载失败。"));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

function normalizeUsernameInput(value = "") {
  return value.trim().toLowerCase();
}

function usernameToAuthEmail(username = "") {
  return `${normalizeUsernameInput(username)}@${AUTH_EMAIL_DOMAIN}`;
}

function authEmailToUsername(email = "") {
  return email.split("@")[0] || "";
}

function getScopedStorageKey(baseKey, scope = "") {
  return scope ? `${baseKey}:${scope}` : baseKey;
}

function normalizeWeekdays(value) {
  if (Array.isArray(value) && value.length) {
    return DAY_ORDER.filter((day) => value.includes(day));
  }
  if (typeof value === "string" && value) {
    return DAY_ORDER.includes(value) ? [value] : ["Montag"];
  }
  return ["Montag"];
}

function formatWeekdays(value) {
  return normalizeWeekdays(value).join(" / ");
}

function parseSerializedScheduleEntries(value = "") {
  if (typeof value !== "string" || !value.includes("||")) return [];
  return value
    .split("||")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [weekdayPart, ...timeParts] = item.split("@");
      return {
        weekday: DAY_ORDER.includes(weekdayPart) ? weekdayPart : "Montag",
        time: formatTimeRangeInput(timeParts.join("@").trim()),
      };
    });
}

function normalizeScheduleEntries(scheduleEntries, weekdays, time) {
  if (Array.isArray(scheduleEntries) && scheduleEntries.length) {
    return scheduleEntries.map((entry) => ({
      weekday: DAY_ORDER.includes(entry?.weekday) ? entry.weekday : "Montag",
      time: formatTimeRangeInput(entry?.time || ""),
    }));
  }

  const parsedSerializedEntries = parseSerializedScheduleEntries(time);
  if (parsedSerializedEntries.length) {
    return parsedSerializedEntries;
  }

  const normalizedWeekdays = normalizeWeekdays(weekdays);
  return normalizedWeekdays.map((weekday) => ({
    weekday,
    time: formatTimeRangeInput(time || ""),
  }));
}

function serializeScheduleEntries(scheduleEntries = []) {
  return scheduleEntries
    .map((entry) => `${entry.weekday}@${formatTimeRangeInput(entry.time || "")}`)
    .join("||");
}

function getScheduleWeekdays(scheduleEntries = []) {
  return DAY_ORDER.filter((day) => scheduleEntries.some((entry) => entry.weekday === day));
}

function formatScheduleEntries(scheduleEntries = []) {
  return scheduleEntries
    .map((entry) => `${entry.weekday} · ${entry.time || "时间待定"}`)
    .join(" / ");
}

function getPrimaryScheduleEntry(scheduleEntries = []) {
  return scheduleEntries[0] || { ...EMPTY_SCHEDULE_ENTRY };
}

function getEntityScheduleEntries(entity) {
  return normalizeScheduleEntries(entity?.scheduleEntries, entity?.weekdays ?? entity?.weekday, entity?.time || "");
}

function getEntityScheduleLabel(entity) {
  return formatScheduleEntries(getEntityScheduleEntries(entity));
}

function isUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function withTimeout(promise, ms, errorMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(errorMessage)), ms);
    }),
  ]);
}

function formatDate(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatDateTime(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function getStoragePublicUrl(storagePath = "") {
  if (!storagePath || !isSupabaseConfigured || !supabase) return "";
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || "";
}

function formatTimeRangeInput(value = "") {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;

  const start = `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  const endDigits = digits.slice(4);

  if (endDigits.length <= 2) {
    return `${start} - ${endDigits}`;
  }

  return `${start} - ${endDigits.slice(0, 2)}${endDigits.length > 2 ? `:${endDigits.slice(2, 4)}` : ""}`;
}

function parseTimeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function validateCourseForm(form) {
  const errors = {};
  const name = form.name.trim();
  const scheduleEntries = normalizeScheduleEntries(form.scheduleEntries, form.weekdays, form.time);

  if (!name) {
    errors.name = "请输入课程名称。";
  }

  if (!scheduleEntries.length) {
    errors.scheduleEntries = "至少添加一条上课安排。";
  }

  for (const entry of scheduleEntries) {
    if (!DAY_ORDER.includes(entry.weekday)) {
      errors.scheduleEntries = "每条上课安排都要选择星期。";
      break;
    }

    const time = (entry.time || "").trim();
    if (time) {
      const match = time.match(TIME_RANGE_REGEX);
      if (!match) {
        errors.scheduleEntries = "每条时间格式都应为 xx:xx - xx:xx。";
        break;
      }
      const startMinutes = parseTimeToMinutes(`${match[1]}:${match[2]}`);
      const endMinutes = parseTimeToMinutes(`${match[3]}:${match[4]}`);
      if (endMinutes <= startMinutes) {
        errors.scheduleEntries = "每条上课安排的结束时间都必须晚于开始时间。";
        break;
      }
    }
  }

  return errors;
}

function validateReviewForm(form) {
  const errors = {};
  if (!form.sourceCourseId) {
    errors.sourceCourseId = "请选择一门课程来创建复习条目。";
  }

  return errors;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putFileRecord(record) {
  const db = await openDB();
  const arrayBuffer = await record.blob.arrayBuffer();
  const newRecord = { ...record, blob: arrayBuffer };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(newRecord);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function getFileRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteFileRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

function buildTermWeeks() {
  const start = new Date(`${TERM_START}T00:00:00`);
  const end = new Date(`${TERM_END}T00:00:00`);
  const weeks = [];
  let cursor = new Date(start);
  let weekNumber = 1;

  while (cursor <= end) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weeks.push({
      weekNumber,
      start: weekStart.toISOString(),
      end: weekEnd.toISOString(),
      label: `W${weekNumber} · ${formatDate(weekStart)} - ${formatDate(weekEnd)}`,
    });
    cursor.setDate(cursor.getDate() + 7);
    weekNumber += 1;
  }

  return weeks;
}

const TERM_WEEKS = buildTermWeeks();

function buildWeeklyRecords() {
  return TERM_WEEKS.map((week) => ({
    id: uid(),
    weekNumber: week.weekNumber,
    label: week.label,
    lectureDone: false,
    homeworkDone: false,
  }));
}

function buildReviewWeeklyRecords() {
  return TERM_WEEKS.map((week) => ({
    id: uid(),
    weekNumber: week.weekNumber,
    label: week.label,
    reviewDone: false,
  }));
}

function makeCourse(template = {}) {
  const scheduleEntries = normalizeScheduleEntries(template.scheduleEntries, template.weekdays ?? template.weekday, template.time || "");
  return {
    id: template.id || uid(),
    name: template.name || "",
    teacher: template.teacher || "",
    kind: template.kind || "Vorlesung",
    scheduleEntries,
    weekdays: getScheduleWeekdays(scheduleEntries),
    time: serializeScheduleEntries(scheduleEntries),
    room: template.room || "",
    quickNotes: template.quickNotes || "",
    files: template.files || [],
    archived: Boolean(template.archived),
    archiveMarked: Boolean(template.archiveMarked),
    createdAt: template.createdAt || new Date().toISOString(),
    weeklyRecords: template.weeklyRecords || buildWeeklyRecords(),
  };
}

function makeReviewItem(template = {}) {
  const scheduleEntries = normalizeScheduleEntries(template.scheduleEntries, template.weekdays ?? template.weekday, template.time || "");
  return {
    id: template.id || uid(),
    name: template.name || "",
    subject: template.subject || "",
    sourceCourseId: template.sourceCourseId || "",
    scheduleEntries,
    weekdays: getScheduleWeekdays(scheduleEntries),
    time: serializeScheduleEntries(scheduleEntries),
    room: template.room || "",
    notes: template.notes || "",
    files: (template.files || []).map((file) => ({ ...file, reviewed: Boolean(file.reviewed) })),
    archived: Boolean(template.archived),
    archiveMarked: Boolean(template.archiveMarked),
    createdAt: template.createdAt || new Date().toISOString(),
    weeklyRecords: template.weeklyRecords || buildReviewWeeklyRecords(),
  };
}

function normalizeCourse(course) {
  if (!course) return null;
  if (Array.isArray(course.weeklyRecords)) {
    return makeCourse({
      ...course,
      weeklyRecords: TERM_WEEKS.map((week, index) => ({
        id: course.weeklyRecords[index]?.id || uid(),
        weekNumber: week.weekNumber,
        label: week.label,
        lectureDone: Boolean(course.weeklyRecords[index]?.lectureDone),
        homeworkDone: Boolean(course.weeklyRecords[index]?.homeworkDone),
      })),
    });
  }

  const lectures = Array.isArray(course.lectures) ? course.lectures : [];
  const assignments = Array.isArray(course.assignments) ? course.assignments : [];

  return makeCourse({
    ...course,
    weeklyRecords: TERM_WEEKS.map((week, index) => ({
      id: uid(),
      weekNumber: week.weekNumber,
      label: week.label,
      lectureDone: Boolean(lectures[index]?.done),
      homeworkDone: Boolean(assignments[index]?.done),
    })),
  });
}

function normalizeReviewItem(item) {
  if (!item) return null;
  if (Array.isArray(item.weeklyRecords)) {
    return makeReviewItem({
      ...item,
      weeklyRecords: TERM_WEEKS.map((week, index) => ({
        id: item.weeklyRecords[index]?.id || uid(),
        weekNumber: week.weekNumber,
        label: week.label,
        reviewDone: Boolean(item.weeklyRecords[index]?.reviewDone),
      })),
    });
  }

  return makeReviewItem({
    ...item,
    weeklyRecords: buildReviewWeeklyRecords(),
  });
}

function getCurrentWeekNumber(now = new Date()) {
  const start = new Date(`${TERM_START}T00:00:00`);
  const end = new Date(`${TERM_END}T23:59:59`);
  if (now < start) return 1;
  if (now > end) return TERM_WEEKS.length;
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.min(TERM_WEEKS.length, Math.floor(diffDays / 7) + 1);
}

function getMillisecondsUntilNextDay(reference = new Date()) {
  const nextDay = new Date(reference);
  nextDay.setHours(24, 0, 1, 0);
  return Math.max(1000, nextDay.getTime() - reference.getTime());
}

function courseSort(a, b) {
  const scheduleA = normalizeScheduleEntries(a.scheduleEntries, a.weekdays ?? a.weekday, a.time || "");
  const scheduleB = normalizeScheduleEntries(b.scheduleEntries, b.weekdays ?? b.weekday, b.time || "");
  const dayA = DAY_ORDER.indexOf(getPrimaryScheduleEntry(scheduleA).weekday);
  const dayB = DAY_ORDER.indexOf(getPrimaryScheduleEntry(scheduleB).weekday);
  if (dayA !== dayB) return dayA - dayB;
  return (getPrimaryScheduleEntry(scheduleA).time || "").localeCompare(getPrimaryScheduleEntry(scheduleB).time || "");
}

function findWeeklyRecord(course, weekNumber) {
  return course.weeklyRecords.find((record) => record.weekNumber === weekNumber);
}

function calcCourseProgress(course) {
  const done = course.weeklyRecords.filter((record) => record.lectureDone && record.homeworkDone).length;
  return Math.round((done / course.weeklyRecords.length) * 100);
}

function calcReviewProgress(reviewItem) {
  const total = reviewItem.files?.length || 0;
  if (!total) return 0;
  const done = reviewItem.files.filter((file) => file.reviewed).length;
  return Math.round((done / total) * 100);
}

function groupFiles(files = []) {
  return FILE_CATEGORIES.map((category) => ({
    category,
    items: files.filter((file) => file.category === category),
  }));
}

function readLocalCoursesFromStorage(scope = "") {
  try {
    const sources = scope
      ? [localStorage.getItem(getScopedStorageKey(STORAGE_KEY, scope)), ...LEGACY_KEYS.map((key) => localStorage.getItem(getScopedStorageKey(key, scope)))]
      : [localStorage.getItem(STORAGE_KEY), ...LEGACY_KEYS.map((key) => localStorage.getItem(key))];
    const availableSources = sources.filter(Boolean);
    const source = availableSources[0];
    if (!source) return [];
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed.map(normalizeCourse).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function readLocalReviewsFromStorage(scope = "") {
  try {
    const source = scope ? localStorage.getItem(getScopedStorageKey(REVIEW_STORAGE_KEY, scope)) : localStorage.getItem(REVIEW_STORAGE_KEY);
    if (!source) return [];
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed.map(normalizeReviewItem).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildEntityFilesMap(items = []) {
  return items.reduce((acc, item) => {
    acc[item.id] = item.files || [];
    return acc;
  }, {});
}

function mergeFileLists(primary = [], secondary = []) {
  const seen = new Set(primary.map((file) => file.id));
  return [...primary, ...secondary.filter((file) => !seen.has(file.id))];
}

function weekdayKey(value) {
  return normalizeWeekdays(value).join("|");
}

function courseIdentityKey(course) {
  const scheduleEntries = normalizeScheduleEntries(course.scheduleEntries, course.weekdays ?? course.weekday, course.time || "");
  return [
    course.name || "",
    course.teacher || "",
    course.kind || "",
    weekdayKey(getScheduleWeekdays(scheduleEntries)),
    serializeScheduleEntries(scheduleEntries),
    course.room || "",
    course.archived ? "1" : "0",
  ].join("::");
}

function reviewIdentityKey(item) {
  const scheduleEntries = normalizeScheduleEntries(item.scheduleEntries, item.weekdays ?? item.weekday, item.time || "");
  return [
    item.name || "",
    item.subject || "",
    item.sourceCourseId || "",
    weekdayKey(getScheduleWeekdays(scheduleEntries)),
    serializeScheduleEntries(scheduleEntries),
    item.room || "",
    item.archived ? "1" : "0",
  ].join("::");
}

function sanitizeFileName(name = "file") {
  return name.replace(/[^\w.\-]+/g, "_");
}

function buildCourseFileMetaFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size) || 0,
    category: row.category,
    uploadedAt: row.uploaded_at,
    storagePath: row.storage_path,
  };
}

function buildReviewFileMetaFromRow(row) {
  return {
    id: row.id,
    sourceFileId: row.source_file_id || null,
    name: row.name,
    mime: row.mime,
    size: Number(row.size) || 0,
    category: row.category,
    uploadedAt: row.uploaded_at,
    reviewed: Boolean(row.reviewed),
    storagePath: row.storage_path,
  };
}

function buildCourseRowPayload(course, userId = "") {
  const scheduleEntries = normalizeScheduleEntries(course.scheduleEntries, course.weekdays ?? course.weekday, course.time || "");
  return {
    ...(isUuid(course.id) ? { id: course.id } : {}),
    ...(userId ? { user_id: userId } : {}),
    name: course.name || "",
    teacher: course.teacher || "",
    kind: course.kind || "Vorlesung",
    weekdays: getScheduleWeekdays(scheduleEntries),
    time: serializeScheduleEntries(scheduleEntries),
    room: course.room || "",
    quick_notes: course.quickNotes || "",
    archived: Boolean(course.archived),
    archive_marked: Boolean(course.archiveMarked),
  };
}

function buildReviewRowPayload(item, userId = "") {
  const scheduleEntries = normalizeScheduleEntries(item.scheduleEntries, item.weekdays ?? item.weekday, item.time || "");
  return {
    ...(isUuid(item.id) ? { id: item.id } : {}),
    ...(userId ? { user_id: userId } : {}),
    name: item.name || "",
    subject: item.subject || "",
    source_course_id: isUuid(item.sourceCourseId) ? item.sourceCourseId : null,
    weekdays: getScheduleWeekdays(scheduleEntries),
    time: serializeScheduleEntries(scheduleEntries),
    room: item.room || "",
    notes: item.notes || "",
    archived: Boolean(item.archived),
    archive_marked: Boolean(item.archiveMarked),
  };
}

function buildCourseWeeklyRows(courseId, weeklyRecords = []) {
  const weeklyMap = new Map((weeklyRecords || []).map((record) => [record.weekNumber, record]));
  return TERM_WEEKS.map((week) => {
    const record = weeklyMap.get(week.weekNumber);
    return {
      course_id: courseId,
      week_number: week.weekNumber,
      label: week.label,
      lecture_done: Boolean(record?.lectureDone),
      homework_done: Boolean(record?.homeworkDone),
    };
  });
}

function buildReviewWeeklyRows(reviewId, weeklyRecords = []) {
  const weeklyMap = new Map((weeklyRecords || []).map((record) => [record.weekNumber, record]));
  return TERM_WEEKS.map((week) => {
    const record = weeklyMap.get(week.weekNumber);
    return {
      review_id: reviewId,
      week_number: week.weekNumber,
      label: week.label,
      review_done: Boolean(record?.reviewDone),
    };
  });
}

function hydrateCourseFromRemote(courseRow, weeklyRows = [], files = []) {
  return makeCourse({
    id: courseRow.id,
    name: courseRow.name,
    teacher: courseRow.teacher,
    kind: courseRow.kind,
    weekdays: courseRow.weekdays,
    time: courseRow.time,
    room: courseRow.room,
    quickNotes: courseRow.quick_notes,
    files,
    archived: courseRow.archived,
    archiveMarked: courseRow.archive_marked,
    createdAt: courseRow.created_at,
    weeklyRecords: TERM_WEEKS.map((week) => {
      const row = weeklyRows.find((record) => record.week_number === week.weekNumber);
      return {
        id: row?.id || uid(),
        weekNumber: week.weekNumber,
        label: week.label,
        lectureDone: Boolean(row?.lecture_done),
        homeworkDone: Boolean(row?.homework_done),
      };
    }),
  });
}

function hydrateReviewFromRemote(reviewRow, weeklyRows = [], files = []) {
  return makeReviewItem({
    id: reviewRow.id,
    name: reviewRow.name,
    subject: reviewRow.subject,
    sourceCourseId: reviewRow.source_course_id || "",
    weekdays: reviewRow.weekdays,
    time: reviewRow.time,
    room: reviewRow.room,
    notes: reviewRow.notes,
    files,
    archived: reviewRow.archived,
    archiveMarked: reviewRow.archive_marked,
    createdAt: reviewRow.created_at,
    weeklyRecords: TERM_WEEKS.map((week) => {
      const row = weeklyRows.find((record) => record.week_number === week.weekNumber);
      return {
        id: row?.id || uid(),
        weekNumber: week.weekNumber,
        label: week.label,
        reviewDone: Boolean(row?.review_done),
      };
    }),
  });
}

function dedupeCourses(items = []) {
  const byKey = new Map();
  for (const item of items) {
    const key = courseIdentityKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    const mergedFiles = mergeFileLists(existing.files || [], item.files || []);
    const existingDoneCount = (existing.weeklyRecords || []).filter((record) => record.lectureDone || record.homeworkDone).length;
    const nextDoneCount = (item.weeklyRecords || []).filter((record) => record.lectureDone || record.homeworkDone).length;
    const preferred = nextDoneCount > existingDoneCount || (item.createdAt || "") > (existing.createdAt || "") ? item : existing;
    byKey.set(key, { ...preferred, files: mergedFiles });
  }
  return Array.from(byKey.values());
}

function dedupeReviews(items = []) {
  const byKey = new Map();
  for (const item of items) {
    const key = reviewIdentityKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    const mergedFiles = mergeFileLists(existing.files || [], item.files || []);
    const existingReviewedCount = (existing.files || []).filter((file) => file.reviewed).length;
    const nextReviewedCount = (item.files || []).filter((file) => file.reviewed).length;
    const preferred = nextReviewedCount > existingReviewedCount || (item.createdAt || "") > (existing.createdAt || "") ? item : existing;
    byKey.set(key, { ...preferred, files: mergedFiles });
  }
  return Array.from(byKey.values());
}

async function saveCourseToSupabaseRecord(course, userId = "") {
  if (!supabase) return course;
  let payload = buildCourseRowPayload(course, userId);

  if (!isUuid(course.id)) {
    const { data: existingRows, error: findError } = await supabase
      .from("courses")
      .select("*")
      .eq("name", course.name || "")
      .eq("kind", course.kind || "Vorlesung")
      .eq("time", payload.time)
      .eq("room", course.room || "");
    if (findError) throw findError;
    const matchedRow = (existingRows || []).find((row) => courseIdentityKey({
      name: row.name,
      teacher: row.teacher,
      kind: row.kind,
      weekdays: row.weekdays,
      time: row.time,
      room: row.room,
      archived: row.archived,
    }) === courseIdentityKey(course));
    if (matchedRow?.id) {
      payload = { ...payload, id: matchedRow.id };
    }
  }

  const { data: courseRow, error: courseError } = await supabase
    .from("courses")
    .upsert(payload)
    .select("*")
    .single();
  if (courseError) throw courseError;

  const { error: weeklyError } = await supabase
    .from("course_weekly_records")
    .upsert(buildCourseWeeklyRows(courseRow.id, course.weeklyRecords), { onConflict: "course_id,week_number" });
  if (weeklyError) throw weeklyError;

  const { data: weeklyRows, error: fetchWeeklyError } = await supabase
    .from("course_weekly_records")
    .select("*")
    .eq("course_id", courseRow.id);
  if (fetchWeeklyError) throw fetchWeeklyError;

  return hydrateCourseFromRemote(courseRow, weeklyRows || [], course.files || []);
}

async function saveReviewToSupabaseRecord(item, userId = "") {
  if (!supabase) return item;
  let payload = buildReviewRowPayload(item, userId);

  if (!isUuid(item.id)) {
    const { data: existingRows, error: findError } = await supabase
      .from("reviews")
      .select("*")
      .eq("name", item.name || "")
      .eq("subject", item.subject || "")
      .eq("time", payload.time)
      .eq("room", item.room || "");
    if (findError) throw findError;
    const matchedRow = (existingRows || []).find((row) => reviewIdentityKey({
      name: row.name,
      subject: row.subject,
      sourceCourseId: row.source_course_id || "",
      weekdays: row.weekdays,
      time: row.time,
      room: row.room,
      archived: row.archived,
    }) === reviewIdentityKey(item));
    if (matchedRow?.id) {
      payload = { ...payload, id: matchedRow.id };
    }
  }

  const { data: reviewRow, error: reviewError } = await supabase
    .from("reviews")
    .upsert(payload)
    .select("*")
    .single();
  if (reviewError) throw reviewError;

  const { error: weeklyError } = await supabase
    .from("review_weekly_records")
    .upsert(buildReviewWeeklyRows(reviewRow.id, item.weeklyRecords), { onConflict: "review_id,week_number" });
  if (weeklyError) throw weeklyError;

  const { data: weeklyRows, error: fetchWeeklyError } = await supabase
    .from("review_weekly_records")
    .select("*")
    .eq("review_id", reviewRow.id);
  if (fetchWeeklyError) throw fetchWeeklyError;

  return hydrateReviewFromRemote(reviewRow, weeklyRows || [], item.files || []);
}

function MotionButton({ className = "", children, ...props }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.14 }}
      className={className}
      {...props}
    >
      {children}
    </motion.button>
  );
}

function Modal({ open, title, onClose, children, panelClassName = "", bodyClassName = "" }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={classNames("w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl", panelClassName)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-zinc-900">{title}</h2>
              <MotionButton
                onClick={onClose}
                className="rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
              >
                <X className="h-5 w-5" />
              </MotionButton>
            </div>
            <div className={classNames("max-h-[75vh] overflow-y-auto pr-1", bodyClassName)}>{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ProgressBar({ value }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
      <div className="h-full rounded-full bg-zinc-900 transition-all duration-300" style={{ width: `${value}%` }} />
    </div>
  );
}

function StatCard({ icon, label, value, helper, onClick }) {
  return (
    <MotionButton
      onClick={onClick}
      className={classNames(
        "w-full rounded-3xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition sm:p-5",
        onClick ? "hover:border-zinc-300 hover:bg-zinc-50" : "cursor-default"
      )}
    >
      <div className="mb-3 flex items-center gap-3 text-zinc-500">
        <div className="rounded-2xl bg-zinc-100 p-2">{icon}</div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-zinc-900">{value}</div>
      <div className="mt-1 text-sm text-zinc-500">{helper}</div>
    </MotionButton>
  );
}

function SectionCard({ title, subtitle, right, children, stickyHeader = false }) {
  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div
        className={classNames(
          "mb-4 flex flex-wrap items-start justify-between gap-3",
          stickyHeader ? "sticky top-28 z-30 rounded-2xl bg-white/95 p-3 shadow-sm ring-1 ring-zinc-200 backdrop-blur" : ""
        )}
      >
        <div>
          <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-zinc-500">{subtitle}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, description, action }) {
  return (
    <div className="rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
        <FolderOpen className="h-6 w-6 text-zinc-500" />
      </div>
      <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function NavTab({ active, icon, label, onClick }) {
  return (
    <MotionButton
      onClick={onClick}
      className={classNames(
        "inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition sm:w-auto",
        active ? "bg-zinc-900 text-white" : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50"
      )}
    >
      {icon}
      {label}
    </MotionButton>
  );
}

function StatusPill({ done, doneLabel, todoLabel, onClick }) {
  return (
    <MotionButton
      onClick={onClick}
      className={classNames(
        "inline-flex items-center justify-center rounded-2xl px-3 py-2 text-sm font-medium transition",
        done ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200" : "bg-rose-100 text-rose-700 ring-1 ring-rose-200"
      )}
    >
      {done ? doneLabel : todoLabel}
    </MotionButton>
  );
}

function CourseCard({ course, currentWeekNumber, selected, onOpen, onEdit, onDelete, onArchive, bulkMode, checked, onToggleSelect }) {
  const currentRecord = findWeeklyRecord(course, currentWeekNumber);
  const progress = calcCourseProgress(course);
  const scheduleLabel = getEntityScheduleLabel(course);
  const primaryAction = bulkMode ? onToggleSelect : onOpen;

  return (
    <div className={classNames("rounded-3xl border bg-white p-4 shadow-sm transition", selected ? "border-zinc-900" : "border-zinc-200")}>
      <div className="flex flex-col gap-4">
        <button onClick={primaryAction} className="min-w-0 text-left">
          <div className="truncate text-xl font-semibold text-zinc-900">{course.name}</div>
          <div className="mt-1 text-sm text-zinc-500">{scheduleLabel || "时间待定"}</div>
          <div className="mt-1 text-xs text-zinc-500">{course.kind}{course.room ? ` · ${course.room}` : ""}</div>
        </button>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {bulkMode ? (
            <MotionButton
              onClick={onToggleSelect}
              className={classNames(
                "col-span-2 inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium sm:col-span-1",
                checked ? "border border-zinc-900 bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
              )}
            >
              <CheckCircle2 className="h-4 w-4" />
              {checked ? "已选中" : "选择"}
            </MotionButton>
          ) : null}
          {!bulkMode ? (
            <>
              <MotionButton onClick={onOpen} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                <Eye className="h-4 w-4" />
                查看
              </MotionButton>
              <MotionButton onClick={onEdit} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                <Pencil className="h-4 w-4" />
                编辑
              </MotionButton>
              <MotionButton onClick={onArchive} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                <Archive className="h-4 w-4" />
                归档
              </MotionButton>
              <MotionButton onClick={onDelete} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
                删除
              </MotionButton>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
          <span>本学期进度</span>
          <span>{progress}%</span>
        </div>
        <ProgressBar value={progress} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={classNames("rounded-full px-3 py-2 text-xs font-medium", currentRecord?.lectureDone ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
          {currentRecord?.lectureDone ? "本周已上课" : "本周未上课"}
        </span>
        <span className={classNames("rounded-full px-3 py-2 text-xs font-medium", currentRecord?.homeworkDone ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
          {currentRecord?.homeworkDone ? "本周已写作业" : "本周未写作业"}
        </span>
      </div>
    </div>
  );
}

function ToolbarRow({ children }) {
  return (
    <div className="-mx-1 rounded-2xl p-1">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>
    </div>
  );
}

function BulkActionBar({ mode, count, totalCount, onToggleAll, onSubmit, onCancel }) {
  const isDelete = mode === "delete";

  return (
    <div className="sticky top-28 z-30 mb-4 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="rounded-full bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-700">
          {isDelete ? "批量删除模式" : "批量归档模式"}
        </span>
        <span className="text-sm text-zinc-500">已选 {count} 项</span>
        <MotionButton
          onClick={onToggleAll}
          className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          {count === totalCount && totalCount ? "取消全选" : "全选当前列表"}
        </MotionButton>
        <MotionButton
          onClick={onSubmit}
          disabled={!count}
          className={classNames(
            "inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
            isDelete ? "border border-red-200 bg-white text-red-600 hover:bg-red-50" : "bg-zinc-900 text-white hover:bg-zinc-800"
          )}
        >
          {isDelete ? <Trash2 className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {isDelete ? "删除已选" : "归档已选"} {count ? `(${count})` : ""}
        </MotionButton>
        <MotionButton
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <X className="h-4 w-4" />
          取消
        </MotionButton>
      </div>
    </div>
  );
}

function DetailModuleCard({ icon, title, description, meta, onClick }) {
  return (
    <MotionButton
      onClick={onClick}
      className="w-full rounded-3xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-2xl bg-zinc-100 p-3 text-zinc-700">{icon}</div>
        {meta ? <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">{meta}</span> : null}
      </div>
      <div className="mt-4 text-base font-semibold text-zinc-900 sm:text-lg">{title}</div>
      <div className="mt-1 text-sm leading-6 text-zinc-500">{description}</div>
      <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
        点击查看
        <ChevronDown className="h-4 w-4 -rotate-90" />
      </div>
    </MotionButton>
  );
}

function ReviewCard({ item, selected, onOpen, onDelete, onArchive, bulkMode, checked, onToggleSelect }) {
  const progress = calcReviewProgress(item);
  const scheduleLabel = getEntityScheduleLabel(item);
  const primaryAction = bulkMode ? onToggleSelect : onOpen;

  return (
    <div className={classNames("rounded-3xl border bg-white p-4 shadow-sm transition", selected ? "border-zinc-900" : "border-zinc-200")}>
      <div className="flex flex-col gap-4">
        <button onClick={primaryAction} className="min-w-0 text-left">
          <div className="truncate text-xl font-semibold text-zinc-900">{item.name}</div>
          <div className="mt-1 text-sm text-zinc-500">{scheduleLabel || "时间待定"}</div>
          <div className="mt-1 text-xs text-zinc-500">
            {item.subject || "未分类"}
            {item.room ? ` · ${item.room}` : ""}
          </div>
        </button>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {bulkMode ? (
            <MotionButton
              onClick={onToggleSelect}
              className={classNames(
                "col-span-2 inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium sm:col-span-1",
                checked ? "border border-zinc-900 bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
              )}
            >
              <CheckCircle2 className="h-4 w-4" />
              {checked ? "已选中" : "选择"}
            </MotionButton>
          ) : null}
          {!bulkMode ? (
            <>
              <MotionButton onClick={onOpen} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                <Eye className="h-4 w-4" />
                查看
              </MotionButton>
              <MotionButton onClick={onArchive} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                <Archive className="h-4 w-4" />
                归档
              </MotionButton>
              <MotionButton onClick={onDelete} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
                删除
              </MotionButton>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
          <span>复习进度</span>
          <span>{progress}%</span>
        </div>
        <ProgressBar value={progress} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={classNames("rounded-full px-3 py-2 text-xs font-medium", progress === 100 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
          {progress === 100 ? "已复习完成" : "未复习完成"}
        </span>
      </div>
    </div>
  );
}

function FileSection({ title, files, busyFileId, onOpen, onDownload, onDelete, collapsed = false, onToggleCollapse }) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button type="button" onClick={onToggleCollapse} className="flex items-center gap-2 text-left">
          <h4 className="text-base font-semibold text-zinc-900">{title}</h4>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">{files.length} 个文件</span>
        </button>
        <MotionButton
          onClick={onToggleCollapse}
          className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
        >
          {collapsed ? "展开" : "收起"}
        </MotionButton>
      </div>
      {collapsed ? (
        <div className="text-sm text-zinc-500">已收起，点击展开查看文件。</div>
      ) : files.length ? (
        <div className="space-y-3">
          {files.map((file) => (
            <div key={file.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-medium text-zinc-900">{file.name}</div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                <span>{formatBytes(file.size)}</span>
                <span>{file.mime || "未知文件类型"}</span>
                <span>{formatDateTime(file.uploadedAt)}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MotionButton
                  onClick={() => onOpen(file)}
                  disabled={busyFileId === file.id}
                  className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  打开
                </MotionButton>
                <MotionButton
                  onClick={() => onDownload(file)}
                  disabled={busyFileId === file.id}
                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  下载
                </MotionButton>
                <MotionButton
                  onClick={() => onDelete(file.id)}
                  className="rounded-2xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  删除
                </MotionButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-zinc-500">这个分类下还没有文件。</div>
      )}
    </div>
  );
}

function ReviewFileSection({ title, files, busyFileId, onOpen, onDownload, onToggleReview }) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-base font-semibold text-zinc-900">{title}</h4>
        <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">{files.length} 个文件</span>
      </div>
      {files.length ? (
        <div className="space-y-3">
          {files.map((file) => (
            <div key={file.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900">{file.name}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                    <span>{formatBytes(file.size)}</span>
                    <span>{file.mime || "未知文件类型"}</span>
                    <span>{formatDateTime(file.uploadedAt)}</span>
                  </div>
                </div>
                <span className={classNames("rounded-full px-3 py-2 text-xs font-medium", file.reviewed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                  {file.reviewed ? "已复习" : "未复习"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MotionButton
                  onClick={() => onOpen(file)}
                  disabled={busyFileId === file.id}
                  className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  打开
                </MotionButton>
                <MotionButton
                  onClick={() => onDownload(file)}
                  disabled={busyFileId === file.id}
                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  下载
                </MotionButton>
                <MotionButton
                  onClick={() => onToggleReview(file.id)}
                  className={classNames(
                    "rounded-2xl px-3 py-2 text-sm font-medium",
                    file.reviewed ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  )}
                >
                  {file.reviewed ? "标记未复习" : "标记已复习"}
                </MotionButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-zinc-500">这个分类下还没有文件。</div>
      )}
    </div>
  );
}

function FileCoverThumbnail({ file, className = "" }) {
  const isImage = (file?.mime || "").startsWith("image/");
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    let active = true;
    const storagePath = file?.storagePath || "";

    if (!isImage || !storagePath) {
      setImageUrl("");
      return undefined;
    }
    if (!isSupabaseConfigured || !supabase) {
      setImageUrl(getStoragePublicUrl(storagePath));
      return undefined;
    }

    setImageUrl("");

    supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 3600).then(({ data, error }) => {
      if (!active || error) return;
      setImageUrl(data?.signedUrl || "");
    });

    return () => {
      active = false;
    };
  }, [file?.storagePath, isImage]);

  if (imageUrl) {
    return <img src={imageUrl} alt={file?.name || "文件封面"} className={classNames("h-20 w-16 rounded-2xl border border-zinc-200 object-cover", className)} />;
  }

  return (
    <div className={classNames("flex h-20 w-16 flex-col justify-between rounded-2xl border border-zinc-200 bg-zinc-100 p-2", className)}>
      <FileText className="h-4 w-4 text-zinc-500" />
      <div className="text-[10px] font-medium leading-4 text-zinc-600">{file?.category || "文件"}</div>
    </div>
  );
}

function StatusActionBar({ hasUnsavedStatusChanges, changedCount, onDiscard, onSave, sticky = false }) {
  return (
    <div
      className={classNames(
        "flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center",
        sticky ? "sticky top-28 z-30 rounded-2xl border border-amber-200 bg-white/95 p-2 shadow-sm backdrop-blur" : "",
      )}
    >
      {hasUnsavedStatusChanges ? <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-medium text-amber-700">已改 {changedCount} 项</span> : null}
      <MotionButton
        onClick={onDiscard}
        disabled={!hasUnsavedStatusChanges}
        className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        放弃修改
      </MotionButton>
      <MotionButton
        onClick={onSave}
        disabled={!hasUnsavedStatusChanges}
        className="rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        保存状态
      </MotionButton>
    </div>
  );
}

function TurnstileWidget({ siteKey, resetNonce, onTokenChange }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const tokenChangeRef = useRef(onTokenChange);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    tokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    if (!siteKey) {
      tokenChangeRef.current("");
      return undefined;
    }

    let active = true;

    loadTurnstileScript()
      .then((turnstile) => {
        if (!active || !containerRef.current || !turnstile) return;
        setLoadError("");
        containerRef.current.innerHTML = "";
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "light",
          callback: (token) => tokenChangeRef.current(token || ""),
          "expired-callback": () => tokenChangeRef.current(""),
          "error-callback": () => tokenChangeRef.current(""),
        });
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error?.message || "Turnstile 加载失败。");
      });

    return () => {
      active = false;
      tokenChangeRef.current("");
      if (window.turnstile && widgetIdRef.current !== null) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (!siteKey) return;
    tokenChangeRef.current("");
    if (window.turnstile && widgetIdRef.current !== null) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetNonce, siteKey]);

  if (!siteKey) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
        还没有配置 `VITE_TURNSTILE_SITE_KEY`，目前无法启用 Turnstile 验证。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 p-2" />
      {loadError ? <div className="text-xs text-rose-600">{loadError}</div> : <div className="text-xs text-zinc-500">请先完成人机验证，再提交注册或登录。</div>}
    </div>
  );
}

function AuthScreen({ mode, form, error, info, busy, captchaResetNonce, onCaptchaChange, onChange, onSubmit, onSwitchMode }) {
  const isRegister = mode === "register";

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-10 text-zinc-900">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_420px]">
          <div className="rounded-[2rem] border border-zinc-200 bg-white p-8 shadow-sm">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
              <GraduationCap className="h-3.5 w-3.5" />
              Semester Study Hub
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">课程与复习按账号独立保存</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-500">
              注册或登录后，每个用户都会拥有自己的课程、复习、每周状态和文件记录。不同账号之间的数据不会混在一起。
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-sm font-semibold text-zinc-900">账号登录</div>
                <div className="mt-2 text-sm leading-6 text-zinc-500">使用账户名和密码进入自己的学习空间。</div>
              </div>
              <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-sm font-semibold text-zinc-900">数据隔离</div>
                <div className="mt-2 text-sm leading-6 text-zinc-500">课程、复习和文件都只属于当前登录用户。</div>
              </div>
              <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-sm font-semibold text-zinc-900">持续同步</div>
                <div className="mt-2 text-sm leading-6 text-zinc-500">登录后继续使用现有 Supabase 云端同步流程。</div>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-zinc-950">{isRegister ? "注册账号" : "登录账号"}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{isRegister ? "创建新用户后，就会自动拥有独立的数据空间。" : "输入账户名和密码，进入你自己的课程数据。"}</p>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-zinc-700">账户名</div>
                <input
                  value={form.username}
                  onChange={(event) => onChange("username", event.target.value)}
                  placeholder="例如：alice_01"
                  autoComplete="username"
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
                />
                <div className="mt-2 text-xs text-zinc-500">支持小写字母、数字、下划线、点和连字符，长度 3-32 位。</div>
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-zinc-700">密码</div>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => onChange("password", event.target.value)}
                  placeholder="至少 6 位"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
                />
              </label>

              {isRegister ? (
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-zinc-700">确认密码</div>
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={(event) => onChange("confirmPassword", event.target.value)}
                    placeholder="再次输入密码"
                    autoComplete="new-password"
                    className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
                  />
                </label>
              ) : null}

              <div className="space-y-2">
                <div className="text-sm font-medium text-zinc-700">安全验证</div>
                <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} resetNonce={captchaResetNonce} onTokenChange={onCaptchaChange} />
              </div>

              {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
              {info ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{info}</div> : null}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <MotionButton
                  type="submit"
                  disabled={busy}
                  className="inline-flex flex-1 items-center justify-center rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  {busy ? "提交中..." : isRegister ? "注册并进入" : "登录"}
                </MotionButton>
                <MotionButton
                  type="button"
                  onClick={onSwitchMode}
                  className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  {isRegister ? "去登录" : "去注册"}
                </MotionButton>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SemesterStudyHub() {
  const [courses, setCourses] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [session, setSession] = useState(null);
  const [authResolved, setAuthResolved] = useState(!isSupabaseConfigured);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "", confirmPassword: "" });
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetNonce, setCaptchaResetNonce] = useState(0);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [query, setQuery] = useState("");
  const [reviewQuery, setReviewQuery] = useState("");
  const [archiveQuery, setArchiveQuery] = useState("");
  const [reviewArchiveQuery, setReviewArchiveQuery] = useState("");
  const [courseBulkMode, setCourseBulkMode] = useState(null);
  const [reviewBulkMode, setReviewBulkMode] = useState(null);
  const [selectedCourseIdsForBatchDelete, setSelectedCourseIdsForBatchDelete] = useState([]);
  const [selectedReviewIdsForBatchDelete, setSelectedReviewIdsForBatchDelete] = useState([]);
  const [page, setPage] = useState("overview");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showCourseSearchModal, setShowCourseSearchModal] = useState(false);
  const [showReviewSearchModal, setShowReviewSearchModal] = useState(false);
  const [showStatusHistoryModal, setShowStatusHistoryModal] = useState(false);
  const [selectedStatusHistoryWeekNumber, setSelectedStatusHistoryWeekNumber] = useState(null);
  const [activeCourseDetailPanel, setActiveCourseDetailPanel] = useState(null);
  const [activeReviewDetailPanel, setActiveReviewDetailPanel] = useState(null);
  const [editingCourseId, setEditingCourseId] = useState(null);
  const [editingReviewId, setEditingReviewId] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [unsavedPromptState, setUnsavedPromptState] = useState(null);
  const [toastMessage, setToastMessage] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isMigratingLegacyFiles, setIsMigratingLegacyFiles] = useState(false);
  const [statusDrafts, setStatusDrafts] = useState({});
  const [reviewStatusDrafts, setReviewStatusDrafts] = useState({});
  const [weekdayFilter, setWeekdayFilter] = useState("全部星期");
  const [archiveWeekdayFilter, setArchiveWeekdayFilter] = useState("全部星期");
  const [unfinishedOnly, setUnfinishedOnly] = useState(false);
  const [hasFilesOnly, setHasFilesOnly] = useState(false);
  const [reviewWeekdayFilter, setReviewWeekdayFilter] = useState("全部星期");
  const [reviewUnfinishedOnly, setReviewUnfinishedOnly] = useState(false);
  const [reviewHasFilesOnly, setReviewHasFilesOnly] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("笔记");
  const [uploading, setUploading] = useState(false);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [reviewUploadCategory, setReviewUploadCategory] = useState("笔记");
  const [reviewUploading, setReviewUploading] = useState(false);
  const [isReviewFileDragActive, setIsReviewFileDragActive] = useState(false);
  const [busyFileId, setBusyFileId] = useState(null);
  const [reviewBusyFileId, setReviewBusyFileId] = useState(null);
  const [collapsedCourseFileGroups, setCollapsedCourseFileGroups] = useState({});
  const [createForm, setCreateForm] = useState(EMPTY_COURSE_FORM);
  const [reviewForm, setReviewForm] = useState(EMPTY_REVIEW_FORM);
  const [courseFormErrors, setCourseFormErrors] = useState({});
  const [reviewFormErrors, setReviewFormErrors] = useState({});
  const [isSavingCourse, setIsSavingCourse] = useState(false);
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [currentDateTick, setCurrentDateTick] = useState(() => Date.now());
  const fileInputRef = useRef(null);
  const fileDragDepthRef = useRef(0);
  const reviewFileInputRef = useRef(null);
  const reviewFileDragDepthRef = useRef(0);
  const accountMenuRef = useRef(null);
  const bootstrapStartedRef = useRef("");
  const legacyFileMigrationStartedRef = useRef("");
  const didInitHistoryRef = useRef(false);
  const suppressHistoryPushRef = useRef(false);
  const currentUser = session?.user || null;
  const currentUserId = currentUser?.id || "";
  const currentUsername = currentUser?.user_metadata?.username || authEmailToUsername(currentUser?.email || "");
  const storageScope = isSupabaseConfigured ? currentUserId : "";
  const courseStorageKey = useMemo(() => getScopedStorageKey(STORAGE_KEY, storageScope), [storageScope]);
  const reviewStorageKey = useMemo(() => getScopedStorageKey(REVIEW_STORAGE_KEY, storageScope), [storageScope]);
  const buildOwnedStoragePath = (kind, entityId, fileId, fileName) => `${currentUserId}/${kind}/${entityId}/${fileId}-${sanitizeFileName(fileName)}`;
  const currentWeekNumber = useMemo(() => getCurrentWeekNumber(new Date(currentDateTick)), [currentDateTick]);
  const previousWeekNumber = currentWeekNumber > 1 ? currentWeekNumber - 1 : null;
  const currentWeekLabel = TERM_WEEKS[currentWeekNumber - 1]?.label || "";
  const historyState = useMemo(
    () => ({
      page,
      selectedCourseId: page === "courseDetail" ? selectedCourseId : null,
      selectedReviewId: page === "reviewDetail" ? selectedReviewId : null,
    }),
    [page, selectedCourseId, selectedReviewId]
  );

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;

    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        console.error("Failed to restore auth session.", error);
      }
      setSession(data?.session || null);
      setAuthResolved(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setAuthResolved(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured && !authResolved) return undefined;

    const bootstrapKey = isSupabaseConfigured ? currentUserId || "anonymous" : "local-mode";
    if (bootstrapStartedRef.current === bootstrapKey) return undefined;
    bootstrapStartedRef.current = bootstrapKey;
    setIsBootstrapping(true);
    let cancelled = false;

    async function saveCourseToSupabase(course) {
      const { data: courseRow, error: courseError } = await supabase
        .from("courses")
        .upsert(buildCourseRowPayload(course, currentUserId))
        .select("*")
        .single();
      if (courseError) throw courseError;

      const { error: weeklyError } = await supabase
        .from("course_weekly_records")
        .upsert(buildCourseWeeklyRows(courseRow.id, course.weeklyRecords), { onConflict: "course_id,week_number" });
      if (weeklyError) throw weeklyError;

      const { data: weeklyRows, error: fetchWeeklyError } = await supabase
        .from("course_weekly_records")
        .select("*")
        .eq("course_id", courseRow.id);
      if (fetchWeeklyError) throw fetchWeeklyError;

      return hydrateCourseFromRemote(courseRow, weeklyRows || [], course.files || []);
    }

    async function saveReviewToSupabase(item) {
      const { data: reviewRow, error: reviewError } = await supabase
        .from("reviews")
        .upsert(buildReviewRowPayload(item, currentUserId))
        .select("*")
        .single();
      if (reviewError) throw reviewError;

      const { error: weeklyError } = await supabase
        .from("review_weekly_records")
        .upsert(buildReviewWeeklyRows(reviewRow.id, item.weeklyRecords), { onConflict: "review_id,week_number" });
      if (weeklyError) throw weeklyError;

      const { data: weeklyRows, error: fetchWeeklyError } = await supabase
        .from("review_weekly_records")
        .select("*")
        .eq("review_id", reviewRow.id);
      if (fetchWeeklyError) throw fetchWeeklyError;

      return hydrateReviewFromRemote(reviewRow, weeklyRows || [], item.files || []);
    }

    async function fetchRemoteDataset(localCourses, localReviews) {
      const localCourseFilesMap = buildEntityFilesMap(localCourses);
      const localReviewFilesMap = buildEntityFilesMap(localReviews);

      const { data: courseRows, error: coursesError } = await supabase.from("courses").select("*").order("created_at", { ascending: true });
      if (coursesError) throw coursesError;

      const { data: reviewRows, error: reviewsError } = await supabase.from("reviews").select("*").order("created_at", { ascending: true });
      if (reviewsError) throw reviewsError;

      const courseIds = (courseRows || []).map((course) => course.id);
      const reviewIds = (reviewRows || []).map((item) => item.id);

      const { data: courseWeeklyRows, error: courseWeeklyError } = courseIds.length
        ? await supabase.from("course_weekly_records").select("*").in("course_id", courseIds)
        : { data: [], error: null };
      if (courseWeeklyError) throw courseWeeklyError;

      const { data: reviewWeeklyRows, error: reviewWeeklyError } = reviewIds.length
        ? await supabase.from("review_weekly_records").select("*").in("review_id", reviewIds)
        : { data: [], error: null };
      if (reviewWeeklyError) throw reviewWeeklyError;

      const { data: courseFileRows, error: courseFilesError } = courseIds.length
        ? await supabase.from("course_files").select("*").in("course_id", courseIds)
        : { data: [], error: null };
      if (courseFilesError) throw courseFilesError;

      const { data: reviewFileRows, error: reviewFilesError } = reviewIds.length
        ? await supabase.from("review_files").select("*").in("review_id", reviewIds)
        : { data: [], error: null };
      if (reviewFilesError) throw reviewFilesError;

      return {
        courses: dedupeCourses((courseRows || []).map((courseRow) =>
          hydrateCourseFromRemote(
            courseRow,
            (courseWeeklyRows || []).filter((record) => record.course_id === courseRow.id),
            mergeFileLists(
              (courseFileRows || []).filter((row) => row.course_id === courseRow.id).map(buildCourseFileMetaFromRow),
              localCourseFilesMap[courseRow.id] || []
            )
          )
        )),
        reviews: dedupeReviews((reviewRows || []).map((reviewRow) =>
          hydrateReviewFromRemote(
            reviewRow,
            (reviewWeeklyRows || []).filter((record) => record.review_id === reviewRow.id),
            mergeFileLists(
              (reviewFileRows || []).filter((row) => row.review_id === reviewRow.id).map(buildReviewFileMetaFromRow),
              localReviewFilesMap[reviewRow.id] || []
            )
          )
        )),
      };
    }

    async function migrateLocalDataToSupabase(localCourses, localReviews, existingCourseIdMap = new Map()) {
      const migratedCourses = [];
      const courseIdMap = new Map(existingCourseIdMap);

      for (const course of localCourses) {
        const savedCourse = await saveCourseToSupabase({ ...course, id: undefined });
        migratedCourses.push(savedCourse);
        courseIdMap.set(course.id, savedCourse.id);
      }

      const migratedReviews = [];
      for (const item of localReviews) {
        const savedReview = await saveReviewToSupabase({
          ...item,
          id: undefined,
          sourceCourseId: courseIdMap.get(item.sourceCourseId) || "",
        });
        migratedReviews.push(savedReview);
      }

      return { courses: migratedCourses, reviews: migratedReviews };
    }

    async function bootstrapData() {
      const localCourses = readLocalCoursesFromStorage(storageScope);
      const localReviews = readLocalReviewsFromStorage(storageScope);

      if (!isSupabaseConfigured || !supabase) {
        if (!cancelled) {
          setCourses(localCourses);
          setReviews(localReviews);
          setIsBootstrapping(false);
        }
        return;
      }

      if (!currentUserId) {
        setCourses([]);
        setReviews([]);
        setIsBootstrapping(false);
        return;
      }

      try {
        const remoteData = await withTimeout(
          fetchRemoteDataset(localCourses, localReviews),
          8000,
          "云端数据加载超时"
        );

        const courseIdentityMap = new Map(
          remoteData.courses.map((course) => [courseIdentityKey(course), course])
        );
        const existingCourseIdMap = new Map();
        localCourses.forEach((course) => {
          const matchedRemoteCourse = courseIdentityMap.get(courseIdentityKey(course));
          if (matchedRemoteCourse) {
            existingCourseIdMap.set(course.id, matchedRemoteCourse.id);
          }
        });

        const localOnlyCourses = localCourses.filter((course) => !courseIdentityMap.has(courseIdentityKey(course)));

        const remoteReviewIdentitySet = new Set(
          remoteData.reviews.map((item) => reviewIdentityKey(item))
        );
        const localOnlyReviews = localReviews.filter((item) => {
          const resolvedSourceCourseId = existingCourseIdMap.get(item.sourceCourseId) || item.sourceCourseId || "";
          return !remoteReviewIdentitySet.has(reviewIdentityKey({ ...item, sourceCourseId: resolvedSourceCourseId }));
        });

        if (localOnlyCourses.length || localOnlyReviews.length) {
          const migratedData = await withTimeout(
            migrateLocalDataToSupabase(localOnlyCourses, localOnlyReviews, existingCourseIdMap),
            12000,
            "补充同步本地数据到云端超时"
          );
          const mergedCourses = dedupeCourses([...remoteData.courses, ...migratedData.courses]);
          const mergedReviews = dedupeReviews([...remoteData.reviews, ...migratedData.reviews]);
          localStorage.setItem(courseStorageKey, JSON.stringify(mergedCourses));
          localStorage.setItem(reviewStorageKey, JSON.stringify(mergedReviews));
          setCourses(mergedCourses);
          setReviews(mergedReviews);
          setToastMessage("已补充同步本地新增课程与复习到云端。");
          setIsBootstrapping(false);
          return;
        }

        if (remoteData.courses.length || remoteData.reviews.length) {
          setCourses(remoteData.courses);
          setReviews(remoteData.reviews);
          setIsBootstrapping(false);
          return;
        }

        if (localCourses.length || localReviews.length) {
          const migratedData = await withTimeout(
            migrateLocalDataToSupabase(localCourses, localReviews),
            12000,
            "本地数据迁移到云端超时"
          );
          localStorage.setItem(courseStorageKey, JSON.stringify(migratedData.courses));
          localStorage.setItem(reviewStorageKey, JSON.stringify(migratedData.reviews));
          setCourses(migratedData.courses);
          setReviews(migratedData.reviews);
          setToastMessage("已把本地课程与复习数据迁移到云端。");
          setIsBootstrapping(false);
          return;
        }

        localStorage.setItem(courseStorageKey, JSON.stringify([]));
        localStorage.setItem(reviewStorageKey, JSON.stringify([]));
        setCourses([]);
        setReviews([]);
        setIsBootstrapping(false);
      } catch (error) {
        console.error("Failed to bootstrap Supabase data.", error);
        setCourses(localCourses);
        setReviews(localReviews);
        setToastMessage(`云端数据读取失败，已临时回退到本地数据。${error?.message ? `（${error.message}）` : ""}`);
        setIsBootstrapping(false);
      }
    }

    bootstrapData();
    return () => {
      cancelled = true;
    };
  }, [authResolved, courseStorageKey, currentUserId, reviewStorageKey, storageScope]);

  useEffect(() => {
    if (isSupabaseConfigured && !currentUserId) return;
    localStorage.setItem(courseStorageKey, JSON.stringify(courses));
  }, [courseStorageKey, courses, currentUserId]);

  useEffect(() => {
    if (isSupabaseConfigured && !currentUserId) return;
    localStorage.setItem(reviewStorageKey, JSON.stringify(reviews));
  }, [currentUserId, reviewStorageKey, reviews]);

  useEffect(() => {
    if (page !== "courseDetail") {
      setActiveCourseDetailPanel(null);
    }
    if (page !== "reviewDetail") {
      setActiveReviewDetailPanel(null);
    }
    if (page !== "status") {
      setShowStatusHistoryModal(false);
      setSelectedStatusHistoryWeekNumber(null);
    }
  }, [page, selectedCourseId, selectedReviewId]);

  useEffect(() => {
    if (!showAccountMenu) return undefined;

    const handlePointerDown = (event) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setShowAccountMenu(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showAccountMenu]);

  useEffect(() => {
    setCollapsedCourseFileGroups({});
  }, [selectedCourseId]);

  useEffect(() => {
    const migrationKey = isSupabaseConfigured ? currentUserId || "anonymous" : "local-mode";
    if (legacyFileMigrationStartedRef.current === migrationKey || isBootstrapping) return undefined;
    legacyFileMigrationStartedRef.current = migrationKey;

    async function migrateLegacyFilesToSupabase() {
      if (!isSupabaseConfigured || !supabase || !currentUserId || isBootstrapping || isMigratingLegacyFiles) return;

      const hasLegacyCourseFiles = courses.some((course) => (course.files || []).some((file) => !file.storagePath));
      const hasLegacyReviewFiles = reviews.some((item) => (item.files || []).some((file) => !file.storagePath));
      if (!hasLegacyCourseFiles && !hasLegacyReviewFiles) return;

      setIsMigratingLegacyFiles(true);
      try {
        const courseFileIdMap = new Map();
        const nextCourses = [];

        for (const course of courses) {
          const nextFiles = [];
          for (const file of course.files || []) {
            if (file.storagePath) {
              nextFiles.push(file);
              continue;
            }

            const record = await getFileRecord(file.id).catch(() => null);
            if (!record?.blob) {
              nextFiles.push(file);
              continue;
            }

            const nextId = crypto.randomUUID();
            const storagePath = buildOwnedStoragePath("courses", course.id, nextId, file.name);
            const blob = new Blob([record.blob], { type: file.mime || record.mime || "application/octet-stream" });
            const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, blob, {
              upsert: true,
              contentType: file.mime || record.mime || "application/octet-stream",
            });
            if (uploadError) throw uploadError;

            const { error: insertError } = await supabase.from("course_files").insert({
              user_id: currentUserId,
              id: nextId,
              course_id: course.id,
              name: file.name,
              mime: file.mime || record.mime || "",
              size: file.size || record.size || 0,
              category: file.category,
              storage_path: storagePath,
              uploaded_at: file.uploadedAt || record.uploadedAt || new Date().toISOString(),
            });
            if (insertError) throw insertError;

            courseFileIdMap.set(file.id, nextId);
            nextFiles.push({
              ...file,
              id: nextId,
              storagePath,
            });
          }
          nextCourses.push({ ...course, files: nextFiles });
        }

        const nextReviews = [];
        for (const item of reviews) {
          const nextFiles = [];
          for (const file of item.files || []) {
            if (file.storagePath) {
              nextFiles.push({
                ...file,
                sourceFileId: courseFileIdMap.get(file.sourceFileId) || file.sourceFileId || null,
              });
              continue;
            }

            const record = await getFileRecord(file.id).catch(() => null);
            if (!record?.blob) {
              nextFiles.push({
                ...file,
                sourceFileId: courseFileIdMap.get(file.sourceFileId) || file.sourceFileId || null,
              });
              continue;
            }

            const nextId = crypto.randomUUID();
            const storagePath = buildOwnedStoragePath("reviews", item.id, nextId, file.name);
            const blob = new Blob([record.blob], { type: file.mime || record.mime || "application/octet-stream" });
            const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, blob, {
              upsert: true,
              contentType: file.mime || record.mime || "application/octet-stream",
            });
            if (uploadError) throw uploadError;

            const remappedSourceFileId = courseFileIdMap.get(file.sourceFileId) || (isUuid(file.sourceFileId) ? file.sourceFileId : null);
            const { error: insertError } = await supabase.from("review_files").insert({
              user_id: currentUserId,
              id: nextId,
              review_id: item.id,
              source_file_id: remappedSourceFileId,
              name: file.name,
              mime: file.mime || record.mime || "",
              size: file.size || record.size || 0,
              category: file.category,
              storage_path: storagePath,
              reviewed: Boolean(file.reviewed),
              uploaded_at: file.uploadedAt || record.uploadedAt || new Date().toISOString(),
            });
            if (insertError) throw insertError;

            nextFiles.push({
              ...file,
              id: nextId,
              sourceFileId: remappedSourceFileId,
              storagePath,
            });
          }
          nextReviews.push({ ...item, files: nextFiles });
        }

        setCourses(nextCourses);
        setReviews(nextReviews);
        showToast("旧文件已迁移到云端。");
      } catch (error) {
        console.error("Failed to migrate legacy files to Supabase Storage.", error);
        showToast("旧文件迁移到云端失败，当前仍保留本地兼容。");
      } finally {
        setIsMigratingLegacyFiles(false);
      }
    }

    migrateLegacyFilesToSupabase();
    return undefined;
  }, [courses, currentUserId, isBootstrapping, isMigratingLegacyFiles, reviews]);

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timer = window.setTimeout(() => setToastMessage(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCurrentDateTick(Date.now()), getMillisecondsUntilNextDay(new Date()));
    return () => window.clearTimeout(timer);
  }, [currentDateTick]);

  useEffect(() => {
    const handlePopState = (event) => {
      const nextState = event.state;
      suppressHistoryPushRef.current = true;
      setPage(nextState?.page || "overview");
      setSelectedCourseId(nextState?.selectedCourseId ?? null);
      setSelectedReviewId(nextState?.selectedReviewId ?? null);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!didInitHistoryRef.current) {
      window.history.replaceState(historyState, "");
      didInitHistoryRef.current = true;
      return;
    }

    if (suppressHistoryPushRef.current) {
      suppressHistoryPushRef.current = false;
      return;
    }

    const currentState = window.history.state;
    if (
      currentState?.page === historyState.page &&
      currentState?.selectedCourseId === historyState.selectedCourseId &&
      currentState?.selectedReviewId === historyState.selectedReviewId
    ) {
      return;
    }

    window.history.pushState(historyState, "");
  }, [historyState]);

  const hasUnsavedCourseStatusChanges = useMemo(() => Object.keys(statusDrafts).length > 0, [statusDrafts]);
  const statusDraftSummary = useMemo(() => {
    const courseCount = Object.keys(statusDrafts).length;
    let weekCount = 0;
    let fieldCount = 0;

    Object.values(statusDrafts).forEach((courseDraft) => {
      weekCount += Object.keys(courseDraft).length;
      Object.values(courseDraft).forEach((recordDraft) => {
        fieldCount += ["lectureDone", "homeworkDone"].filter((field) => field in recordDraft).length;
      });
    });

    return { courseCount, weekCount, fieldCount };
  }, [statusDrafts]);

  const hasUnsavedReviewStatusChanges = useMemo(() => Object.keys(reviewStatusDrafts).length > 0, [reviewStatusDrafts]);
  const reviewStatusDraftSummary = useMemo(() => {
    const itemCount = Object.keys(reviewStatusDrafts).length;
    let weekCount = 0;
    let fieldCount = 0;

    Object.values(reviewStatusDrafts).forEach((reviewDraft) => {
      weekCount += Object.keys(reviewDraft).length;
      Object.values(reviewDraft).forEach((recordDraft) => {
        fieldCount += ["reviewDone"].filter((field) => field in recordDraft).length;
      });
    });

    return { itemCount, weekCount, fieldCount };
  }, [reviewStatusDrafts]);

  const hasUnsavedStatusChanges = hasUnsavedCourseStatusChanges || hasUnsavedReviewStatusChanges;
  const allStatusDraftSummary = useMemo(
    () => ({
      fieldCount: statusDraftSummary.fieldCount + reviewStatusDraftSummary.fieldCount,
      courseFieldCount: statusDraftSummary.fieldCount,
      reviewFieldCount: reviewStatusDraftSummary.fieldCount,
      courseCount: statusDraftSummary.courseCount,
      reviewCount: reviewStatusDraftSummary.itemCount,
    }),
    [reviewStatusDraftSummary.fieldCount, reviewStatusDraftSummary.itemCount, statusDraftSummary.courseCount, statusDraftSummary.fieldCount]
  );

  useEffect(() => {
    if (!hasUnsavedStatusChanges) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedStatusChanges]);

  useEffect(() => {
    const activeCourses = courses.filter((course) => !course.archived);
    if (!activeCourses.length) {
      setSelectedCourseId(null);
      return;
    }
    const exists = activeCourses.some((course) => course.id === selectedCourseId);
    if (!exists) setSelectedCourseId(activeCourses[0].id);
  }, [courses, selectedCourseId]);

  useEffect(() => {
    if (!reviews.length) {
      setSelectedReviewId(null);
      return;
    }
    const exists = reviews.some((item) => item.id === selectedReviewId);
    if (!exists) setSelectedReviewId(reviews[0].id);
  }, [reviews, selectedReviewId]);

  useEffect(() => {
    setSelectedCourseIdsForBatchDelete((prev) => prev.filter((id) => courses.some((course) => course.id === id && !course.archived)));
  }, [courses]);

  useEffect(() => {
    setSelectedReviewIdsForBatchDelete((prev) => prev.filter((id) => reviews.some((item) => item.id === id && !item.archived)));
  }, [reviews]);

  const coursesWithStatusDrafts = useMemo(
    () =>
      courses.map((course) => {
        const courseDraft = statusDrafts[course.id];
        if (!courseDraft) return course;
        return {
          ...course,
          weeklyRecords: course.weeklyRecords.map((record) => {
            const draft = courseDraft[record.weekNumber];
            return draft ? { ...record, ...draft } : record;
          }),
        };
      }),
    [courses, statusDrafts]
  );

  const reviewsWithStatusDrafts = useMemo(
    () =>
      reviews.map((item) => {
        const reviewDraft = reviewStatusDrafts[item.id];
        if (!reviewDraft) return item;
        return {
          ...item,
          weeklyRecords: item.weeklyRecords.map((record) => {
            const draft = reviewDraft[record.weekNumber];
            return draft ? { ...record, ...draft } : record;
          }),
        };
      }),
    [reviewStatusDrafts, reviews]
  );

  const activeCourses = useMemo(() => coursesWithStatusDrafts.filter((course) => !course.archived).sort(courseSort), [coursesWithStatusDrafts]);
  const archivedCourses = useMemo(() => coursesWithStatusDrafts.filter((course) => course.archived).sort(courseSort), [coursesWithStatusDrafts]);
  const reviewItems = useMemo(() => reviewsWithStatusDrafts.slice().sort(courseSort), [reviewsWithStatusDrafts]);
  const activeReviewItems = useMemo(() => reviewItems.filter((item) => !item.archived), [reviewItems]);
  const archivedReviewItems = useMemo(() => reviewItems.filter((item) => item.archived), [reviewItems]);
  const availableReviewCourses = useMemo(
    () => activeCourses.filter((course) => !reviews.some((item) => item.sourceCourseId === course.id)),
    [activeCourses, reviews]
  );

  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activeCourses.filter((course) => {
      const scheduleEntries = getEntityScheduleEntries(course);
      const scheduleLabel = formatScheduleEntries(scheduleEntries);
      const haystack = `${course.name} ${course.teacher} ${course.kind} ${scheduleLabel}`.toLowerCase();
      const currentRecord = findWeeklyRecord(course, currentWeekNumber);
      const matchesSearch = !q || haystack.includes(q);
      const matchesWeekday = weekdayFilter === "全部星期" || getScheduleWeekdays(scheduleEntries).includes(weekdayFilter);
      const matchesUnfinished = !unfinishedOnly || !(currentRecord?.lectureDone && currentRecord?.homeworkDone);
      const matchesFiles = !hasFilesOnly || Boolean(course.files?.length);
      return matchesSearch && matchesWeekday && matchesUnfinished && matchesFiles;
    });
  }, [activeCourses, currentWeekNumber, hasFilesOnly, query, unfinishedOnly, weekdayFilter]);

  const filteredReviewItems = useMemo(() => {
    const q = reviewQuery.trim().toLowerCase();
    return activeReviewItems.filter((item) => {
      const scheduleEntries = getEntityScheduleEntries(item);
      const haystack = `${item.name} ${item.subject} ${formatScheduleEntries(scheduleEntries)} ${item.room}`.toLowerCase();
      const progress = calcReviewProgress(item);
      const matchesSearch = !q || haystack.includes(q);
      const matchesWeekday = reviewWeekdayFilter === "全部星期" || getScheduleWeekdays(scheduleEntries).includes(reviewWeekdayFilter);
      const matchesUnfinished = !reviewUnfinishedOnly || progress < 100;
      const matchesFiles = !reviewHasFilesOnly || Boolean(item.files?.length);
      return matchesSearch && matchesWeekday && matchesUnfinished && matchesFiles;
    });
  }, [activeReviewItems, reviewHasFilesOnly, reviewQuery, reviewUnfinishedOnly, reviewWeekdayFilter]);

  const filteredArchivedCourses = useMemo(() => {
    const q = archiveQuery.trim().toLowerCase();
    return archivedCourses.filter((course) => {
      const scheduleEntries = getEntityScheduleEntries(course);
      const haystack = `${course.name} ${course.teacher} ${course.kind} ${formatScheduleEntries(scheduleEntries)} ${course.room}`.toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      const matchesWeekday = archiveWeekdayFilter === "全部星期" || getScheduleWeekdays(scheduleEntries).includes(archiveWeekdayFilter);
      return matchesSearch && matchesWeekday;
    });
  }, [archiveQuery, archiveWeekdayFilter, archivedCourses]);

  const filteredArchivedReviewItems = useMemo(() => {
    const q = reviewArchiveQuery.trim().toLowerCase();
    return archivedReviewItems.filter((item) => {
      const haystack = `${item.name} ${item.subject} ${getEntityScheduleLabel(item)} ${item.room}`.toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      return matchesSearch;
    });
  }, [archivedReviewItems, reviewArchiveQuery]);

  const selectedCourse = useMemo(() => activeCourses.find((course) => course.id === selectedCourseId) || null, [activeCourses, selectedCourseId]);
  const selectedReview = useMemo(() => reviewItems.find((item) => item.id === selectedReviewId) || null, [reviewItems, selectedReviewId]);
  const selectedCourseCurrentRecord = useMemo(
    () => (selectedCourse ? findWeeklyRecord(selectedCourse, currentWeekNumber) : null),
    [currentWeekNumber, selectedCourse]
  );
  const selectedCourseFiles = useMemo(() => groupFiles(selectedCourse?.files || []), [selectedCourse]);
  const selectedReviewFiles = useMemo(() => groupFiles(selectedReview?.files || []), [selectedReview]);
  const selectedReviewProgress = useMemo(() => (selectedReview ? calcReviewProgress(selectedReview) : 0), [selectedReview]);
  const selectedReviewSourceCourse = useMemo(
    () => courses.find((course) => course.id === selectedReview?.sourceCourseId) || null,
    [courses, selectedReview?.sourceCourseId]
  );
  const selectedCourseRecentFiles = useMemo(
    () =>
      [...(selectedCourse?.files || [])].sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()),
    [selectedCourse]
  );
  const latestSelectedCourseFile = selectedCourseRecentFiles[0] || null;
  const selectedReviewRecentFiles = useMemo(
    () =>
      [...(selectedReview?.files || [])]
        .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime())
        .slice(0, 3),
    [selectedReview]
  );
  const selectedCourseTodoItems = useMemo(() => {
    if (!selectedCourseCurrentRecord) return [];
    const todoItems = [];
    if (!selectedCourseCurrentRecord.lectureDone) todoItems.push("本周上课");
    if (!selectedCourseCurrentRecord.homeworkDone) todoItems.push("本周作业");
    return todoItems;
  }, [selectedCourseCurrentRecord]);
  const selectedReviewTodoItems = useMemo(() => (selectedReviewProgress === 100 ? [] : ["复习文件"]), [selectedReviewProgress]);
  const courseInfoContent = selectedCourse ? (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="text-xs font-medium text-zinc-500">课程名称</div>
        <div className="mt-2 text-sm font-medium text-zinc-900">{selectedCourse.name || "未填写"}</div>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="text-xs font-medium text-zinc-500">授课教师</div>
        <div className="mt-2 text-sm font-medium text-zinc-900">{selectedCourse.teacher || "未填写"}</div>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="text-xs font-medium text-zinc-500">课程类型</div>
        <div className="mt-2 text-sm font-medium text-zinc-900">{selectedCourse.kind || "未填写"}</div>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="text-xs font-medium text-zinc-500">星期</div>
        <div className="mt-2 text-sm font-medium text-zinc-900">{getScheduleWeekdays(getEntityScheduleEntries(selectedCourse)).join(" / ") || "未填写"}</div>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="text-xs font-medium text-zinc-500">上课时间</div>
        <div className="mt-2 text-sm font-medium text-zinc-900">{getEntityScheduleLabel(selectedCourse) || "未填写"}</div>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="text-xs font-medium text-zinc-500">教室 / 地点</div>
        <div className="mt-2 text-sm font-medium text-zinc-900">{selectedCourse.room || "未填写"}</div>
      </div>
    </div>
  ) : null;
  const courseFilesContent = selectedCourse ? (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={uploadCategory}
          onChange={(e) => setUploadCategory(e.target.value)}
          className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
        >
          {FILE_CATEGORIES.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
        <MotionButton
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          <Upload className="h-4 w-4" />
          {uploading ? "上传中..." : `上传到${uploadCategory}`}
        </MotionButton>
      </div>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={handleFileDragEnter}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
        className={classNames(
          "w-full rounded-3xl border-2 border-dashed px-5 py-6 text-left transition",
          isFileDragActive ? "border-zinc-900 bg-zinc-100" : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-white"
        )}
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-900">{uploading ? "正在上传文件..." : "拖拽文件到这里，或点击选择文件"}</div>
            <div className="mt-1 text-sm text-zinc-500">会按当前分类“{uploadCategory}”直接上传到这门课里。</div>
          </div>
          <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm">支持多文件</span>
        </div>
      </button>
      {selectedCourseFiles.length ? (
        selectedCourseFiles.map((group) => (
          <FileSection
            key={group.category}
            title={group.category}
            files={group.items}
            busyFileId={busyFileId}
            onOpen={(file) => openStoredFile(file, false)}
            onDownload={(file) => openStoredFile(file, true)}
            onDelete={(fileId) => requestRemoveFile(selectedCourse.id, fileId)}
            collapsed={collapsedCourseFileGroups[group.category] ?? true}
            onToggleCollapse={() => toggleCourseFileGroupCollapse(group.category)}
          />
        ))
      ) : (
        <div className="rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-500">这门课还没有上传文件。</div>
      )}
    </div>
  ) : null;
  const courseWeeklyRecordsContent = selectedCourse ? (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-y-2">
        <thead>
          <tr className="text-left text-sm text-zinc-500">
            <th className="px-3">周次</th>
            <th className="px-3">上课</th>
            <th className="px-3">作业</th>
          </tr>
        </thead>
        <tbody>
          {selectedCourse.weeklyRecords.map((record) => {
            const isCurrentWeek = record.weekNumber === currentWeekNumber;
            return (
              <tr key={record.id} className={classNames("bg-zinc-50 text-sm shadow-sm", isCurrentWeek ? "ring-1 ring-zinc-300" : "")}>
                <td className="rounded-l-3xl px-3 py-3 align-middle">
                  <div className="font-medium text-zinc-900">{record.label}</div>
                  {isCurrentWeek ? <div className="mt-1 text-xs text-zinc-500">当前周</div> : null}
                </td>
                <td className="px-3 py-3 align-middle">
                  <StatusPill done={record.lectureDone} doneLabel="已上" todoLabel="未上" onClick={() => toggleWeeklyField(selectedCourse.id, record.weekNumber, "lectureDone")} />
                </td>
                <td className="rounded-r-3xl px-3 py-3 align-middle">
                  <StatusPill done={record.homeworkDone} doneLabel="已写" todoLabel="未写" onClick={() => toggleWeeklyField(selectedCourse.id, record.weekNumber, "homeworkDone")} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : null;
  const reviewProgressContent = selectedReview ? (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-xs font-medium text-zinc-500">当前进度</div>
          <div className="mt-3 text-2xl font-semibold text-zinc-950">{selectedReviewProgress}%</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-xs font-medium text-zinc-500">已复习文件</div>
          <div className="mt-3 text-2xl font-semibold text-zinc-950">{selectedReview.files.filter((file) => file.reviewed).length}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-xs font-medium text-zinc-500">总体状态</div>
          <div className={classNames("mt-3 inline-flex rounded-full px-3 py-2 text-sm font-medium", selectedReviewProgress === 100 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
            {selectedReviewProgress === 100 ? "已复习" : "未复习"}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <ProgressBar value={selectedReviewProgress} />
      </div>
      {selectedReviewTodoItems.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {selectedReviewTodoItems.map((item) => (
            <span key={item} className="rounded-full bg-amber-100 px-3 py-2 text-xs font-medium text-amber-700">
              待处理：{item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;
  const reviewRecentFilesContent = selectedReview ? (
    selectedReviewRecentFiles.length ? (
      <div className="space-y-3">
        {selectedReviewRecentFiles.map((file) => (
          <div key={file.id} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
            <div className="text-sm font-medium text-zinc-900">{file.name}</div>
            <div className="mt-1 text-xs text-zinc-500">{file.category} · {formatDateTime(file.uploadedAt)}</div>
          </div>
        ))}
      </div>
    ) : (
      <div className="text-sm text-zinc-500">这条复习还没有上传过资料。</div>
    )
  ) : null;
  const reviewFilesContent = selectedReview ? (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={reviewUploadCategory}
          onChange={(e) => setReviewUploadCategory(e.target.value)}
          className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
        >
          {FILE_CATEGORIES.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
        <input ref={reviewFileInputRef} type="file" multiple className="hidden" onChange={handleReviewUpload} />
        <MotionButton
          onClick={() => reviewFileInputRef.current?.click()}
          disabled={reviewUploading}
          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:bg-zinc-100"
        >
          <Upload className="h-4 w-4" />
          {reviewUploading ? "上传中..." : "上传复习文件"}
        </MotionButton>
        <MotionButton
          onClick={() => syncReviewFilesFromCourse(selectedReview.id)}
          disabled={reviewUploading || !selectedReviewSourceCourse}
          className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-400"
        >
          同步还原课程文件
        </MotionButton>
      </div>
      <button
        type="button"
        onClick={() => reviewFileInputRef.current?.click()}
        onDragEnter={handleReviewFileDragEnter}
        onDragOver={handleReviewFileDragOver}
        onDragLeave={handleReviewFileDragLeave}
        onDrop={handleReviewFileDrop}
        className={classNames(
          "w-full rounded-3xl border-2 border-dashed px-5 py-6 text-left transition",
          isReviewFileDragActive ? "border-zinc-900 bg-zinc-100" : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-white"
        )}
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-900">{reviewUploading ? "正在上传文件..." : "拖拽文件到这里，或点击选择文件"}</div>
            <div className="mt-1 text-sm text-zinc-500">会按当前分类“{reviewUploadCategory}”直接上传到这条复习里。</div>
          </div>
          <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm">支持多文件</span>
        </div>
      </button>
      {selectedReviewFiles.length ? (
        selectedReviewFiles.map((group) => (
          <ReviewFileSection
            key={group.category}
            title={group.category}
            files={group.items}
            busyFileId={reviewBusyFileId}
            onOpen={(file) => openStoredReviewFile(file, false)}
            onDownload={(file) => openStoredReviewFile(file, true)}
            onToggleReview={(fileId) => toggleReviewFileReviewed(selectedReview.id, fileId)}
          />
        ))
      ) : (
        <div className="rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-500">这条复习还没有文件。</div>
      )}
    </div>
  ) : null;

  const weeklyOverviewRows = useMemo(
    () => activeCourses.map((course) => ({ ...course, currentRecord: findWeeklyRecord(course, currentWeekNumber) })),
    [activeCourses, currentWeekNumber]
  );
  const statusHistoryWeeks = useMemo(
    () =>
      TERM_WEEKS.filter((week) => week.weekNumber < currentWeekNumber)
        .map((week) => {
          const completedCount = activeCourses.filter((course) => {
            const record = findWeeklyRecord(course, week.weekNumber);
            return record?.lectureDone && record?.homeworkDone;
          }).length;

          return {
            ...week,
            completedCount,
            pendingCount: Math.max(activeCourses.length - completedCount, 0),
          };
        })
        .reverse(),
    [activeCourses, currentWeekNumber]
  );
  const selectedStatusHistoryWeek = useMemo(
    () => statusHistoryWeeks.find((week) => week.weekNumber === selectedStatusHistoryWeekNumber) || null,
    [selectedStatusHistoryWeekNumber, statusHistoryWeeks]
  );
  const statusHistoryRows = useMemo(
    () =>
      selectedStatusHistoryWeekNumber
        ? activeCourses.map((course) => ({
            ...course,
            historyRecord: findWeeklyRecord(course, selectedStatusHistoryWeekNumber),
          }))
        : [],
    [activeCourses, selectedStatusHistoryWeekNumber]
  );
  useEffect(() => {
    if (selectedStatusHistoryWeekNumber && !statusHistoryWeeks.some((week) => week.weekNumber === selectedStatusHistoryWeekNumber)) {
      setSelectedStatusHistoryWeekNumber(null);
    }
  }, [selectedStatusHistoryWeekNumber, statusHistoryWeeks]);
  const reviewOverviewRows = useMemo(
    () => activeReviewItems.map((item) => ({ ...item, progress: calcReviewProgress(item) })),
    [activeReviewItems]
  );

  const stats = useMemo(() => {
    const currentRecords = activeCourses.map((course) => findWeeklyRecord(course, currentWeekNumber)).filter(Boolean);
    const filesCount = courses.reduce((sum, course) => sum + (course.files?.length || 0), 0);
    const bothDone = currentRecords.filter((record) => record.lectureDone && record.homeworkDone).length;
    const unfinished = activeCourses.length - bothDone;
    return {
      activeCount: activeCourses.length,
      archivedCount: archivedCourses.length,
      filesCount,
      bothDone,
      unfinished,
    };
  }, [activeCourses, archivedCourses.length, courses, currentWeekNumber]);

  const reviewStats = useMemo(() => {
    const filesCount = reviews.reduce((sum, item) => sum + (item.files?.length || 0), 0);
    const completed = activeReviewItems.filter((item) => calcReviewProgress(item) === 100).length;
    return {
      count: activeReviewItems.length,
      archivedCount: archivedReviewItems.length,
      completed,
      pending: activeReviewItems.length - completed,
      filesCount,
    };
  }, [activeReviewItems, archivedReviewItems.length, reviews]);
  async function commitCourses(nextCourses, deletedCourseIds = []) {
    setCourses(nextCourses);
    if (!isSupabaseConfigured || !supabase) return nextCourses;

    try {
      const savedCourses = [];
      for (const course of nextCourses) {
        savedCourses.push(await saveCourseToSupabaseRecord(course, currentUserId));
      }
      if (deletedCourseIds.length) {
        const remoteIds = deletedCourseIds.filter(isUuid);
        if (remoteIds.length) {
          const { error } = await supabase.from("courses").delete().in("id", remoteIds);
          if (error) throw error;
        }
      }
      setCourses(savedCourses);
      return savedCourses;
    } catch (error) {
      console.error("Failed to sync courses to Supabase.", error);
      setToastMessage("课程云端同步失败，当前先保留本地修改。");
      return nextCourses;
    }
  }

  async function commitReviews(nextReviews, deletedReviewIds = []) {
    setReviews(nextReviews);
    if (!isSupabaseConfigured || !supabase) return nextReviews;

    try {
      const savedReviews = [];
      for (const item of nextReviews) {
        savedReviews.push(await saveReviewToSupabaseRecord(item, currentUserId));
      }
      if (deletedReviewIds.length) {
        const remoteIds = deletedReviewIds.filter(isUuid);
        if (remoteIds.length) {
          const { error } = await supabase.from("reviews").delete().in("id", remoteIds);
          if (error) throw error;
        }
      }
      setReviews(savedReviews);
      return savedReviews;
    } catch (error) {
      console.error("Failed to sync reviews to Supabase.", error);
      setToastMessage("复习云端同步失败，当前先保留本地修改。");
      return nextReviews;
    }
  }

  async function patchCourse(courseId, updater) {
    const nextCourses = courses.map((course) => (course.id === courseId ? updater(course) : course));
    return commitCourses(nextCourses);
  }

  async function patchReviewItem(reviewId, updater) {
    const nextReviews = reviews.map((item) => (item.id === reviewId ? updater(item) : item));
    return commitReviews(nextReviews);
  }

  function showToast(message) {
    setToastMessage(message);
  }

  function updateAuthForm(field, value) {
    setAuthForm((prev) => ({ ...prev, [field]: value }));
    if (authError) setAuthError("");
    if (authInfo) setAuthInfo("");
  }

  function handleCaptchaChange(nextToken) {
    setCaptchaToken(nextToken || "");
    if (authError) setAuthError("");
  }

  function toggleAuthMode() {
    setAuthMode((prev) => (prev === "login" ? "register" : "login"));
    setAuthError("");
    setAuthInfo("");
    setCaptchaToken("");
    setCaptchaResetNonce((prev) => prev + 1);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!supabase) {
      setAuthError("当前还没有配置 Supabase，暂时无法使用账户系统。");
      return;
    }

    const username = normalizeUsernameInput(authForm.username);
    const password = authForm.password;
    const confirmPassword = authForm.confirmPassword;
    const isRegister = authMode === "register";

    if (!USERNAME_REGEX.test(username)) {
      setAuthError("账户名格式不正确，请使用 3-32 位小写字母、数字、下划线、点或连字符。");
      return;
    }
    if (password.length < 6) {
      setAuthError("密码至少需要 6 位。");
      return;
    }
    if (isRegister && password !== confirmPassword) {
      setAuthError("两次输入的密码不一致。");
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setAuthError("请先完成人机验证。");
      return;
    }

    setAuthSubmitting(true);
    setAuthError("");
    setAuthInfo("");

    try {
      const email = usernameToAuthEmail(username);
      if (isRegister) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username },
            captchaToken,
          },
        });
        if (error) throw error;

        setAuthForm({ username: "", password: "", confirmPassword: "" });
        if (data?.session) {
          setAuthInfo("注册成功，已自动登录。");
        } else {
          setAuthMode("login");
          setAuthInfo("注册成功。若后续无法登录，请在 Supabase Auth 设置里关闭邮件确认，因为这里使用的是账户名映射登录。");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: {
            captchaToken,
          },
        });
        if (error) throw error;
        setAuthForm({ username: "", password: "", confirmPassword: "" });
      }
    } catch (error) {
      const message = error?.message || "";
      if (/invalid login credentials/i.test(message)) {
        setAuthError("账户名或密码不正确。");
      } else if (/user already registered/i.test(message) || /already been registered/i.test(message)) {
        setAuthError("这个账户名已经被注册了。");
      } else if (/password/i.test(message) && /6/i.test(message)) {
        setAuthError("密码至少需要 6 位。");
      } else {
        setAuthError(message || "认证失败，请稍后再试。");
      }
    } finally {
      setAuthSubmitting(false);
      setCaptchaToken("");
      setCaptchaResetNonce((prev) => prev + 1);
    }
  }

  async function logoutUser() {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      setShowAccountMenu(false);
      setCourses([]);
      setReviews([]);
      setPage("overview");
      setSelectedCourseId(null);
      setSelectedReviewId(null);
      setStatusDrafts({});
      setReviewStatusDrafts({});
      setToastMessage("");
      setCaptchaToken("");
      setCaptchaResetNonce((prev) => prev + 1);
    } catch (error) {
      console.error("Failed to sign out.", error);
      window.alert("退出登录失败。");
    }
  }

  async function switchAccount() {
    setAuthMode("login");
    setAuthForm({ username: "", password: "", confirmPassword: "" });
    setAuthError("");
    setAuthInfo("");
    setCaptchaToken("");
    setCaptchaResetNonce((prev) => prev + 1);
    await logoutUser();
  }

  function discardStatusChanges() {
    setStatusDrafts({});
  }

  function discardReviewStatusChanges() {
    setReviewStatusDrafts({});
  }

  function discardAllStatusChanges() {
    discardStatusChanges();
    discardReviewStatusChanges();
  }

  function openStatusHistoryModalPanel() {
    setShowStatusHistoryModal(true);
  }

  function closeStatusHistoryModalPanel() {
    setShowStatusHistoryModal(false);
  }

  function openStatusHistoryWeekDetail(weekNumber) {
    setSelectedStatusHistoryWeekNumber(weekNumber);
    setShowStatusHistoryModal(false);
  }

  function closeStatusHistoryWeekDetail() {
    setSelectedStatusHistoryWeekNumber(null);
  }

  function reopenStatusHistoryWeekList() {
    closeStatusHistoryWeekDetail();
    openStatusHistoryModalPanel();
  }

  async function saveStatusChanges(showMessage = true) {
    if (!hasUnsavedCourseStatusChanges) return;
    const nextCourses = courses.map((course) => {
      const courseDraft = statusDrafts[course.id];
      if (!courseDraft) return course;
      return {
        ...course,
        weeklyRecords: course.weeklyRecords.map((record) => {
          const draft = courseDraft[record.weekNumber];
          return draft ? { ...record, ...draft } : record;
        }),
      };
    });
    await commitCourses(nextCourses);
    setStatusDrafts({});
    if (showMessage) showToast("课程状态已保存。");
  }

  async function saveReviewStatusChanges(showMessage = true) {
    if (!hasUnsavedReviewStatusChanges) return;
    const nextReviews = reviews.map((item) => {
      const reviewDraft = reviewStatusDrafts[item.id];
      if (!reviewDraft) return item;
      return {
        ...item,
        weeklyRecords: item.weeklyRecords.map((record) => {
          const draft = reviewDraft[record.weekNumber];
          return draft ? { ...record, ...draft } : record;
        }),
      };
    });
    await commitReviews(nextReviews);
    setReviewStatusDrafts({});
    if (showMessage) showToast("复习状态已保存。");
  }

  async function saveAllStatusChanges() {
    if (hasUnsavedCourseStatusChanges) await saveStatusChanges(false);
    if (hasUnsavedReviewStatusChanges) await saveReviewStatusChanges(false);
    showToast("状态修改已保存。");
  }

  function requestUnsavedStatusPrompt(action) {
    setUnsavedPromptState({
      title: "有未保存的状态修改",
      description: "你修改了课程或复习状态，但还没有保存。要先保存再继续吗？",
      onSave: async () => {
        await saveAllStatusChanges();
        action();
      },
      onDiscard: () => {
        discardAllStatusChanges();
        action();
      },
    });
  }

  function runWithStatusGuard(action) {
    if (hasUnsavedStatusChanges) {
      requestUnsavedStatusPrompt(action);
      return;
    }
    action();
  }

  function requestConfirmation({ title, description, confirmLabel = "确认删除", onConfirm }) {
    setConfirmState({ title, description, confirmLabel, onConfirm });
  }

  async function handleConfirmAction() {
    if (!confirmState?.onConfirm) return;
    const { onConfirm } = confirmState;
    setConfirmState(null);
    await onConfirm();
  }

  async function handleUnsavedPromptSave() {
    if (!unsavedPromptState?.onSave) return;
    const { onSave } = unsavedPromptState;
    setUnsavedPromptState(null);
    await onSave();
  }

  function handleUnsavedPromptDiscard() {
    if (!unsavedPromptState?.onDiscard) return;
    const { onDiscard } = unsavedPromptState;
    setUnsavedPromptState(null);
    onDiscard();
  }

  function resetCourseForm() {
    setCreateForm(EMPTY_COURSE_FORM);
    setCourseFormErrors({});
    setEditingCourseId(null);
  }

  function resetReviewForm() {
    setReviewForm(EMPTY_REVIEW_FORM);
    setReviewFormErrors({});
    setEditingReviewId(null);
  }

  function openCreateModal() {
    runWithStatusGuard(() => {
      resetCourseForm();
      setShowCreateModal(true);
    });
  }

  function closeCourseModal() {
    setShowCreateModal(false);
    resetCourseForm();
  }

  function openReviewModal() {
    runWithStatusGuard(() => {
      resetReviewForm();
      setShowReviewModal(true);
    });
  }

  function closeReviewModal() {
    setShowReviewModal(false);
    resetReviewForm();
  }

  function resetCourseFilters() {
    setQuery("");
    setWeekdayFilter("全部星期");
    setUnfinishedOnly(false);
    setHasFilesOnly(false);
  }

  function resetReviewFilters() {
    setReviewQuery("");
    setReviewWeekdayFilter("全部星期");
    setReviewUnfinishedOnly(false);
    setReviewHasFilesOnly(false);
  }

  function toggleCourseFileGroupCollapse(category) {
    setCollapsedCourseFileGroups((prev) => ({
      ...prev,
      [category]: !(prev[category] ?? true),
    }));
  }

  function updateCourseForm(field, value) {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
    setCourseFormErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function addCourseScheduleEntry() {
    setCreateForm((prev) => ({
      ...prev,
      scheduleEntries: [...(prev.scheduleEntries || []), { ...EMPTY_SCHEDULE_ENTRY }],
    }));
    setCourseFormErrors((prev) => {
      if (!prev.scheduleEntries) return prev;
      const next = { ...prev };
      delete next.scheduleEntries;
      return next;
    });
  }

  function updateCourseScheduleEntry(index, field, value) {
    setCreateForm((prev) => ({
      ...prev,
      scheduleEntries: (prev.scheduleEntries || []).map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, [field]: field === "time" ? formatTimeRangeInput(value) : value }
          : entry
      ),
    }));
    setCourseFormErrors((prev) => {
      if (!prev.scheduleEntries) return prev;
      const next = { ...prev };
      delete next.scheduleEntries;
      return next;
    });
  }

  function removeCourseScheduleEntry(index) {
    setCreateForm((prev) => {
      const currentEntries = prev.scheduleEntries || [];
      if (currentEntries.length <= 1) return prev;
      return {
        ...prev,
        scheduleEntries: currentEntries.filter((_, entryIndex) => entryIndex !== index),
      };
    });
  }

  function updateReviewForm(field, value) {
    setReviewForm((prev) => ({ ...prev, [field]: value }));
    setReviewFormErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function openEditModal(course) {
    runWithStatusGuard(() => {
      setEditingCourseId(course.id);
      setCreateForm({
        name: course.name || "",
        teacher: course.teacher || "",
        kind: course.kind || "Vorlesung",
        scheduleEntries: getEntityScheduleEntries(course),
        room: course.room || "",
      });
      setCourseFormErrors({});
      setShowCreateModal(true);
    });
  }

  function openCourse(courseId) {
    runWithStatusGuard(() => {
      cancelCourseBulkMode();
      setActiveCourseDetailPanel(null);
      setSelectedCourseId(courseId);
      setPage("courseDetail");
    });
  }

  function openReviewItem(reviewId) {
    runWithStatusGuard(() => {
      cancelReviewBulkMode();
      setActiveReviewDetailPanel(null);
      setSelectedReviewId(reviewId);
      setPage("reviewDetail");
    });
  }

  function navigateToPage(nextPage) {
    runWithStatusGuard(() => {
      if (nextPage !== "courseDetail") setActiveCourseDetailPanel(null);
      if (nextPage !== "reviewDetail") setActiveReviewDetailPanel(null);
      setPage(nextPage);
    });
  }

  function startCourseBulkMode(mode) {
    setCourseBulkMode((prev) => (prev === mode ? null : mode));
    setSelectedCourseIdsForBatchDelete([]);
  }

  function startReviewBulkMode(mode) {
    setReviewBulkMode((prev) => (prev === mode ? null : mode));
    setSelectedReviewIdsForBatchDelete([]);
  }

  function cancelCourseBulkMode() {
    setCourseBulkMode(null);
    setSelectedCourseIdsForBatchDelete([]);
  }

  function cancelReviewBulkMode() {
    setReviewBulkMode(null);
    setSelectedReviewIdsForBatchDelete([]);
  }

  function toggleCourseBatchSelection(courseId) {
    setSelectedCourseIdsForBatchDelete((prev) =>
      prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId]
    );
  }

  function toggleReviewBatchSelection(reviewId) {
    setSelectedReviewIdsForBatchDelete((prev) =>
      prev.includes(reviewId) ? prev.filter((id) => id !== reviewId) : [...prev, reviewId]
    );
  }

  function toggleSelectAllCourses() {
    setSelectedCourseIdsForBatchDelete((prev) =>
      prev.length === filteredCourses.length ? [] : filteredCourses.map((course) => course.id)
    );
  }

  function toggleSelectAllReviews() {
    setSelectedReviewIdsForBatchDelete((prev) =>
      prev.length === filteredReviewItems.length ? [] : filteredReviewItems.map((item) => item.id)
    );
  }

  async function saveCourse() {
    if (isSavingCourse) return;
    const errors = validateCourseForm(createForm);
    if (Object.keys(errors).length) {
      setCourseFormErrors(errors);
      return;
    }
    const payload = {
      name: createForm.name.trim(),
      teacher: createForm.teacher.trim(),
      kind: createForm.kind,
      scheduleEntries: normalizeScheduleEntries(createForm.scheduleEntries, createForm.weekdays, createForm.time),
      room: createForm.room.trim(),
    };

    setIsSavingCourse(true);
    try {
      if (editingCourseId) {
        await patchCourse(editingCourseId, (course) => ({ ...course, ...payload }));
        setSelectedCourseId(editingCourseId);
        setPage("courseDetail");
        closeCourseModal();
        showToast("课程信息已保存。");
        return;
      }

      const course = makeCourse(payload);
      const savedCourses = await commitCourses([...courses, course]);
      const createdCourse = savedCourses[savedCourses.length - 1] || course;
      setSelectedCourseId(createdCourse.id);
      setPage("courses");
      closeCourseModal();
      showToast("课程已创建。");
    } finally {
      setIsSavingCourse(false);
    }
  }

  async function buildReviewFilesFromCourse(course, reviewId) {
    const copiedFiles = [];
    for (const sourceFile of course.files || []) {
      if (sourceFile.storagePath && isSupabaseConfigured && supabase) {
        const nextId = crypto.randomUUID();
        const uploadedAt = sourceFile.uploadedAt || new Date().toISOString();
        const targetPath = buildOwnedStoragePath("reviews", reviewId, nextId, sourceFile.name);
        const { error: copyError } = await supabase.storage.from(STORAGE_BUCKET).copy(sourceFile.storagePath, targetPath);
        if (copyError) throw copyError;
        const { error: insertError } = await supabase.from("review_files").insert({
          user_id: currentUserId,
          id: nextId,
          review_id: reviewId,
          source_file_id: isUuid(sourceFile.id) ? sourceFile.id : null,
          name: sourceFile.name,
          mime: sourceFile.mime || "",
          size: sourceFile.size || 0,
          category: sourceFile.category,
          storage_path: targetPath,
          reviewed: false,
          uploaded_at: uploadedAt,
        });
        if (insertError) throw insertError;
        copiedFiles.push({
          id: nextId,
          sourceFileId: sourceFile.id,
          name: sourceFile.name,
          mime: sourceFile.mime,
          size: sourceFile.size,
          category: sourceFile.category,
          uploadedAt,
          reviewed: false,
          storagePath: targetPath,
        });
        continue;
      }

      const record = await getFileRecord(sourceFile.id).catch(() => null);
      if (!record?.blob) continue;
      const nextId = uid();
      const blob = new Blob([record.blob], { type: sourceFile.mime });
      await putFileRecord({
        id: nextId,
        reviewId,
        blob,
        name: sourceFile.name,
        mime: sourceFile.mime,
        size: sourceFile.size,
        uploadedAt: sourceFile.uploadedAt || new Date().toISOString(),
      });
      copiedFiles.push({
        ...sourceFile,
        id: nextId,
        sourceFileId: sourceFile.id,
        reviewed: false,
      });
    }
    return copiedFiles;
  }

  async function saveReviewItem() {
    if (isSavingReview) return;
    const errors = validateReviewForm(reviewForm);
    if (Object.keys(errors).length) {
      setReviewFormErrors(errors);
      return;
    }

    const sourceCourse = courses.find((course) => course.id === reviewForm.sourceCourseId);
    if (!sourceCourse) {
      setReviewFormErrors({ sourceCourseId: "所选课程不存在。请重新选择。" });
      return;
    }
    if (reviews.some((item) => item.sourceCourseId === sourceCourse.id)) {
      setReviewFormErrors({ sourceCourseId: "这门课程已经创建过复习条目了。" });
      return;
    }

    const item = makeReviewItem({
      sourceCourseId: sourceCourse.id,
      name: sourceCourse.name,
      subject: sourceCourse.kind,
      scheduleEntries: getEntityScheduleEntries(sourceCourse),
      room: sourceCourse.room,
      notes: "",
      files: [],
    });

    setIsSavingReview(true);
    try {
      const savedReviews = await commitReviews([...reviews, item]);
      const createdReview = savedReviews[savedReviews.length - 1] || item;
      const copiedFiles = await buildReviewFilesFromCourse(sourceCourse, createdReview.id);
      await patchReviewItem(createdReview.id, (reviewItem) => ({ ...reviewItem, files: copiedFiles }));
      setSelectedReviewId(createdReview.id);
      setPage("reviews");
      closeReviewModal();
      showToast(`已从课程“${sourceCourse.name}”创建复习条目。`);
    } catch (error) {
      console.error("Failed to create review item from course files.", error);
      window.alert("创建复习条目失败，文件未复制成功。");
    } finally {
      setIsSavingReview(false);
    }
  }

  async function importStarterCourses() {
    const existingKeys = new Set(courses.map((course) => `${course.name}-${course.kind}-${getEntityScheduleLabel(course)}`));
    const incoming = STARTER_COURSES.filter(
      (course) => !existingKeys.has(`${course.name}-${course.kind}-${getEntityScheduleLabel(course)}`)
    ).map((course) => makeCourse(course));
    if (incoming.length) {
      await commitCourses([...courses, ...incoming]);
    }
    navigateToPage("courses");
  }

  async function uploadFilesToCourse(courseId, entries) {
    let workingCourses = courses;
    const targetIndex = courses.findIndex((course) => course.id === courseId);
    if (targetIndex === -1) return;

    if (isSupabaseConfigured && supabase && !isUuid(courses[targetIndex].id)) {
      workingCourses = await commitCourses(courses);
    }

    const targetCourse = workingCourses[targetIndex] || workingCourses.find((course) => course.id === courseId);
    if (!targetCourse || !entries.length || uploading) return;
    setUploading(true);
    try {
      const metadata = [];
      const linkedReviews = reviews.filter((item) => item.sourceCourseId === targetCourse.id);
      const reviewCopiesById = {};
      for (const entry of entries) {
        const file = entry.file;
        const id = isSupabaseConfigured && supabase ? crypto.randomUUID() : uid();
        const uploadedAt = new Date().toISOString();
        let storagePath = "";

        if (isSupabaseConfigured && supabase) {
          storagePath = buildOwnedStoragePath("courses", targetCourse.id, id, file.name);
          const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, { upsert: true });
          if (uploadError) throw uploadError;
          const { error: insertError } = await supabase.from("course_files").insert({
            user_id: currentUserId,
            id,
            course_id: targetCourse.id,
            name: file.name,
            mime: file.type || "",
            size: file.size || 0,
            category: entry.category,
            storage_path: storagePath,
            uploaded_at: uploadedAt,
          });
          if (insertError) throw insertError;
        } else {
          await putFileRecord({
            id,
            courseId: targetCourse.id,
            blob: file,
            name: file.name,
            mime: file.type,
            size: file.size,
            uploadedAt,
          });
        }

        metadata.push({
          id,
          name: file.name,
          mime: file.type,
          size: file.size,
          category: entry.category,
          uploadedAt,
          ...(storagePath ? { storagePath } : {}),
        });

        for (const reviewItem of linkedReviews) {
          const reviewFileId = isSupabaseConfigured && supabase ? crypto.randomUUID() : uid();
          let reviewStoragePath = "";

          if (isSupabaseConfigured && supabase) {
            reviewStoragePath = buildOwnedStoragePath("reviews", reviewItem.id, reviewFileId, file.name);
            const { error: copyError } = await supabase.storage.from(STORAGE_BUCKET).copy(storagePath, reviewStoragePath);
            if (copyError) throw copyError;
            const { error: insertReviewFileError } = await supabase.from("review_files").insert({
              user_id: currentUserId,
              id: reviewFileId,
              review_id: reviewItem.id,
              source_file_id: id,
              name: file.name,
              mime: file.type || "",
              size: file.size || 0,
              category: entry.category,
              storage_path: reviewStoragePath,
              reviewed: false,
              uploaded_at: uploadedAt,
            });
            if (insertReviewFileError) throw insertReviewFileError;
          } else {
            await putFileRecord({
              id: reviewFileId,
              reviewId: reviewItem.id,
              blob: file,
              name: file.name,
              mime: file.type,
              size: file.size,
              uploadedAt,
            });
          }

          if (!reviewCopiesById[reviewItem.id]) reviewCopiesById[reviewItem.id] = [];
          reviewCopiesById[reviewItem.id].push({
            id: reviewFileId,
            sourceFileId: id,
            name: file.name,
            mime: file.type,
            size: file.size,
            category: entry.category,
            uploadedAt,
            reviewed: false,
            ...(reviewStoragePath ? { storagePath: reviewStoragePath } : {}),
          });
        }
      }
      await patchCourse(targetCourse.id, (course) => ({ ...course, files: [...metadata, ...(course.files || [])] }));
      if (linkedReviews.length) {
        await commitReviews(
          reviews.map((item) => {
            const additions = reviewCopiesById[item.id];
            return additions?.length ? { ...item, files: [...additions, ...(item.files || [])] } : item;
          })
        );
      }
      showToast(`已上传 ${metadata.length} 个文件。`);
    } catch (error) {
      console.error("Failed to upload files for the selected course.", error);
      window.alert(`上传失败，文件未保存。\n${error?.message || "请检查 Storage 配置和课程云端数据是否已同步。"}`);
    } finally {
      setUploading(false);
      setIsFileDragActive(false);
      fileDragDepthRef.current = 0;
    }
  }

  async function uploadFilesToReview(reviewId, entries) {
    let workingReviews = reviews;
    const targetIndex = reviews.findIndex((item) => item.id === reviewId);
    if (targetIndex === -1) return;

    if (isSupabaseConfigured && supabase && !isUuid(reviews[targetIndex].id)) {
      workingReviews = await commitReviews(reviews);
    }

    const targetItem = workingReviews[targetIndex] || workingReviews.find((item) => item.id === reviewId);
    if (!targetItem || !entries.length || reviewUploading) return;
    setReviewUploading(true);
    try {
      const metadata = [];
      for (const entry of entries) {
        const file = entry.file;
        const id = isSupabaseConfigured && supabase ? crypto.randomUUID() : uid();
        const uploadedAt = new Date().toISOString();
        let storagePath = "";

        if (isSupabaseConfigured && supabase) {
          storagePath = buildOwnedStoragePath("reviews", targetItem.id, id, file.name);
          const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, { upsert: true });
          if (uploadError) throw uploadError;
          const { error: insertError } = await supabase.from("review_files").insert({
            user_id: currentUserId,
            id,
            review_id: targetItem.id,
            source_file_id: null,
            name: file.name,
            mime: file.type || "",
            size: file.size || 0,
            category: entry.category,
            storage_path: storagePath,
            reviewed: false,
            uploaded_at: uploadedAt,
          });
          if (insertError) throw insertError;
        } else {
          await putFileRecord({
            id,
            reviewId: targetItem.id,
            blob: file,
            name: file.name,
            mime: file.type,
            size: file.size,
            uploadedAt,
          });
        }

        metadata.push({
          id,
          name: file.name,
          mime: file.type,
          size: file.size,
          category: entry.category,
          uploadedAt,
          reviewed: false,
          ...(storagePath ? { storagePath } : {}),
        });
      }
      await patchReviewItem(targetItem.id, (item) => ({ ...item, files: [...metadata, ...(item.files || [])] }));
      showToast(`已上传 ${metadata.length} 个复习文件。`);
    } catch (error) {
      console.error("Failed to upload files for the selected review item.", error);
      window.alert(`上传失败，文件未保存。\n${error?.message || "请检查 Storage 配置和复习条目云端数据是否已同步。"}`);
    } finally {
      setReviewUploading(false);
      setIsReviewFileDragActive(false);
      reviewFileDragDepthRef.current = 0;
    }
  }

  function toggleWeeklyField(courseId, weekNumber, field) {
    const course = coursesWithStatusDrafts.find((item) => item.id === courseId);
    const baseCourse = courses.find((item) => item.id === courseId);
    const currentRecord = course ? findWeeklyRecord(course, weekNumber) : null;
    const baseRecord = baseCourse ? findWeeklyRecord(baseCourse, weekNumber) : null;
    if (!currentRecord || !baseRecord) return;

    setStatusDrafts((prev) => {
      const next = { ...prev };
      const courseDraft = { ...(next[courseId] || {}) };
      const recordDraft = { ...(courseDraft[weekNumber] || {}) };
      recordDraft[field] = !currentRecord[field];

      const nextLectureDone = recordDraft.lectureDone ?? baseRecord.lectureDone;
      const nextHomeworkDone = recordDraft.homeworkDone ?? baseRecord.homeworkDone;

      if (nextLectureDone === baseRecord.lectureDone && nextHomeworkDone === baseRecord.homeworkDone) {
        delete courseDraft[weekNumber];
      } else {
        courseDraft[weekNumber] = recordDraft;
      }

      if (!Object.keys(courseDraft).length) {
        delete next[courseId];
      } else {
        next[courseId] = courseDraft;
      }

      return next;
    });
  }

  function toggleReviewWeeklyField(reviewId, weekNumber) {
    const item = reviewsWithStatusDrafts.find((entry) => entry.id === reviewId);
    const baseItem = reviews.find((entry) => entry.id === reviewId);
    const currentRecord = item ? findWeeklyRecord(item, weekNumber) : null;
    const baseRecord = baseItem ? findWeeklyRecord(baseItem, weekNumber) : null;
    if (!currentRecord || !baseRecord) return;

    setReviewStatusDrafts((prev) => {
      const next = { ...prev };
      const reviewDraft = { ...(next[reviewId] || {}) };
      const recordDraft = { ...(reviewDraft[weekNumber] || {}) };
      recordDraft.reviewDone = !currentRecord.reviewDone;

      const nextReviewDone = recordDraft.reviewDone ?? baseRecord.reviewDone;
      if (nextReviewDone === baseRecord.reviewDone) {
        delete reviewDraft[weekNumber];
      } else {
        reviewDraft[weekNumber] = recordDraft;
      }

      if (!Object.keys(reviewDraft).length) {
        delete next[reviewId];
      } else {
        next[reviewId] = reviewDraft;
      }

      return next;
    });
  }

  function toggleReviewFileReviewed(reviewId, fileId) {
    patchReviewItem(reviewId, (item) => ({
      ...item,
      files: (item.files || []).map((file) => (file.id === fileId ? { ...file, reviewed: !file.reviewed } : file)),
    }));
  }

  async function archiveCourse(courseId) {
    const target = courses.find((course) => course.id === courseId);
    await patchCourse(courseId, (course) => ({ ...course, archived: true, archiveMarked: false }));
    if (selectedCourseId === courseId) {
      setSelectedCourseId(null);
      if (page === "courseDetail") setPage("courses");
    }
    if (target) showToast(`已归档课程：${target.name}`);
  }

  function requestArchiveCourse(courseId) {
    const target = courses.find((course) => course.id === courseId);
    if (!target) return;
    runWithStatusGuard(() => {
      requestConfirmation({
        title: "确认归档课程？",
        description: `“${target.name}”会移动到过往课程中，之后仍可以恢复。`,
        confirmLabel: "确认归档",
        onConfirm: () => archiveCourse(courseId),
      });
    });
  }

  async function restoreCourse(courseId) {
    const target = courses.find((course) => course.id === courseId);
    await patchCourse(courseId, (course) => ({ ...course, archived: false, archiveMarked: false }));
    setSelectedCourseId(courseId);
    setPage("courses");
    if (target) showToast(`已恢复课程：${target.name}`);
  }

  async function archiveReviewItem(reviewId) {
    const target = reviews.find((item) => item.id === reviewId);
    await patchReviewItem(reviewId, (item) => ({ ...item, archived: true, archiveMarked: false }));
    if (selectedReviewId === reviewId) {
      setSelectedReviewId(null);
      if (page === "reviewDetail") setPage("reviews");
    }
    if (target) showToast(`已归档复习条目：${target.name}`);
  }

  function requestArchiveReviewItem(reviewId) {
    const target = reviews.find((item) => item.id === reviewId);
    if (!target) return;
    runWithStatusGuard(() => {
      requestConfirmation({
        title: "确认归档复习条目？",
        description: `“${target.name}”会移动到过往复习中，之后仍可以恢复。`,
        confirmLabel: "确认归档",
        onConfirm: () => archiveReviewItem(reviewId),
      });
    });
  }

  async function restoreReviewItem(reviewId) {
    const target = reviews.find((item) => item.id === reviewId);
    await patchReviewItem(reviewId, (item) => ({ ...item, archived: false, archiveMarked: false }));
    setSelectedReviewId(reviewId);
    setPage("reviews");
    if (target) showToast(`已恢复复习条目：${target.name}`);
  }

  async function deleteCourse(courseId) {
    const target = courses.find((course) => course.id === courseId);
    if (!target) return;
    await Promise.all((target.files || []).map((file) => deleteFileRecord(file.id).catch(() => null)));
    await commitCourses(courses.filter((course) => course.id !== courseId), [courseId]);
    if (isSupabaseConfigured && supabase && !isUuid(courseId)) {
      const { data: existingRows, error } = await supabase
        .from("courses")
        .select("id,name,teacher,kind,weekdays,time,room,archived")
        .eq("name", target.name || "")
        .eq("kind", target.kind || "Vorlesung")
        .eq("time", formatTimeRangeInput(target.time || ""))
        .eq("room", target.room || "");
      if (!error) {
        const duplicateIds = (existingRows || [])
          .filter((row) => courseIdentityKey({
            name: row.name,
            teacher: row.teacher,
            kind: row.kind,
            weekdays: row.weekdays,
            time: row.time,
            room: row.room,
            archived: row.archived,
          }) === courseIdentityKey(target))
          .map((row) => row.id);
        if (duplicateIds.length) {
          await supabase.from("courses").delete().in("id", duplicateIds);
        }
      }
    }
    if (selectedCourseId === courseId) {
      setSelectedCourseId(null);
      if (page === "courseDetail") setPage("courses");
    }
    showToast(`已删除课程：${target.name}`);
  }

  async function deleteReviewItem(reviewId) {
    const target = reviews.find((item) => item.id === reviewId);
    if (!target) return;
    await Promise.all((target.files || []).map((file) => deleteFileRecord(file.id).catch(() => null)));
    await commitReviews(reviews.filter((item) => item.id !== reviewId), [reviewId]);
    if (isSupabaseConfigured && supabase && !isUuid(reviewId)) {
      const { data: existingRows, error } = await supabase
        .from("reviews")
        .select("id,name,subject,source_course_id,weekdays,time,room,archived")
        .eq("name", target.name || "")
        .eq("subject", target.subject || "")
        .eq("time", formatTimeRangeInput(target.time || ""))
        .eq("room", target.room || "");
      if (!error) {
        const duplicateIds = (existingRows || [])
          .filter((row) => reviewIdentityKey({
            name: row.name,
            subject: row.subject,
            sourceCourseId: row.source_course_id || "",
            weekdays: row.weekdays,
            time: row.time,
            room: row.room,
            archived: row.archived,
          }) === reviewIdentityKey(target))
          .map((row) => row.id);
        if (duplicateIds.length) {
          await supabase.from("reviews").delete().in("id", duplicateIds);
        }
      }
    }
    if (selectedReviewId === reviewId) {
      setSelectedReviewId(null);
      if (page === "reviewDetail") setPage("reviews");
    }
    showToast(`已删除复习条目：${target.name}`);
  }

  function requestDeleteCourse(courseId) {
    const target = courses.find((course) => course.id === courseId);
    if (!target) return;
    runWithStatusGuard(() => {
      requestConfirmation({
        title: "确认删除课程？",
        description: `删除后将同时移除“${target.name}”及其所有上传文件，此操作不可撤销。`,
        onConfirm: () => deleteCourse(courseId),
      });
    });
  }

  function requestDeleteReviewItem(reviewId) {
    const target = reviews.find((item) => item.id === reviewId);
    if (!target) return;
    runWithStatusGuard(() => {
      requestConfirmation({
        title: "确认删除复习条目？",
        description: `删除后将同时移除“${target.name}”及其所有上传文件，此操作不可撤销。`,
        onConfirm: () => deleteReviewItem(reviewId),
      });
    });
  }

  function requestDeleteSelectedCourses() {
    if (!selectedCourseIdsForBatchDelete.length) return;
    const targets = courses.filter((course) => selectedCourseIdsForBatchDelete.includes(course.id));
    runWithStatusGuard(() => {
      requestConfirmation({
        title: "确认批量删除课程？",
        description: `将删除 ${targets.length} 门课程以及它们的文件，此操作不可撤销。`,
        onConfirm: async () => {
          await Promise.all(
            targets.flatMap((course) => (course.files || []).map((file) => deleteFileRecord(file.id).catch(() => null)))
          );
          await commitCourses(courses.filter((course) => !selectedCourseIdsForBatchDelete.includes(course.id)), selectedCourseIdsForBatchDelete);
          setSelectedCourseIdsForBatchDelete([]);
          setCourseBulkMode(null);
          showToast(`已批量删除 ${targets.length} 门课程。`);
        },
      });
    });
  }

  function requestDeleteSelectedReviews() {
    if (!selectedReviewIdsForBatchDelete.length) return;
    const targets = reviews.filter((item) => selectedReviewIdsForBatchDelete.includes(item.id));
    runWithStatusGuard(() => {
      requestConfirmation({
        title: "确认批量删除复习条目？",
        description: `将删除 ${targets.length} 条复习及其文件，此操作不可撤销。`,
        onConfirm: async () => {
          await Promise.all(
            targets.flatMap((item) => (item.files || []).map((file) => deleteFileRecord(file.id).catch(() => null)))
          );
          await commitReviews(reviews.filter((item) => !selectedReviewIdsForBatchDelete.includes(item.id)), selectedReviewIdsForBatchDelete);
          setSelectedReviewIdsForBatchDelete([]);
          setReviewBulkMode(null);
          showToast(`已批量删除 ${targets.length} 条复习。`);
        },
      });
    });
  }

  function requestArchiveSelectedCourses() {
    if (!selectedCourseIdsForBatchDelete.length) return;
    const targets = activeCourses.filter((course) => selectedCourseIdsForBatchDelete.includes(course.id));
    runWithStatusGuard(() => {
      requestConfirmation({
        title: "确认批量归档课程？",
        description: `将归档 ${targets.length} 门课程。`,
        confirmLabel: "确认归档",
        onConfirm: async () => {
          const targetIds = new Set(selectedCourseIdsForBatchDelete);
          await commitCourses(courses.map((course) => (targetIds.has(course.id) ? { ...course, archived: true, archiveMarked: false } : course)));
          if (selectedCourseId && targetIds.has(selectedCourseId) && page === "courseDetail") {
            setSelectedCourseId(null);
            setPage("courses");
          }
          setSelectedCourseIdsForBatchDelete([]);
          setCourseBulkMode(null);
          showToast(`已批量归档 ${targets.length} 门课程。`);
        },
      });
    });
  }

  function requestArchiveSelectedReviews() {
    if (!selectedReviewIdsForBatchDelete.length) return;
    const targets = activeReviewItems.filter((item) => selectedReviewIdsForBatchDelete.includes(item.id));
    runWithStatusGuard(() => {
      requestConfirmation({
        title: "确认批量归档复习？",
        description: `将归档 ${targets.length} 条复习。`,
        confirmLabel: "确认归档",
        onConfirm: async () => {
          const targetIds = new Set(selectedReviewIdsForBatchDelete);
          await commitReviews(reviews.map((item) => (targetIds.has(item.id) ? { ...item, archived: true, archiveMarked: false } : item)));
          if (selectedReviewId && targetIds.has(selectedReviewId) && page === "reviewDetail") {
            setSelectedReviewId(null);
            setPage("reviews");
          }
          setSelectedReviewIdsForBatchDelete([]);
          setReviewBulkMode(null);
          showToast(`已批量归档 ${targets.length} 条复习。`);
        },
      });
    });
  }

  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await uploadFilesToCourse(
      selectedCourse?.id,
      files.map((file) => ({ file, category: uploadCategory }))
    );
  }

  async function handleReviewUpload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await uploadFilesToReview(
      selectedReview?.id,
      files.map((file) => ({ file, category: reviewUploadCategory }))
    );
  }

  function handleFileDragEnter(event) {
    if (uploading) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current += 1;
    setIsFileDragActive(true);
  }

  function handleFileDragOver(event) {
    if (uploading) return;
    event.preventDefault();
    event.stopPropagation();
    if (!isFileDragActive) setIsFileDragActive(true);
  }

  function handleFileDragLeave(event) {
    if (uploading) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) {
      setIsFileDragActive(false);
    }
  }

  async function handleFileDrop(event) {
    if (uploading) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer?.files || []);
    await uploadFilesToCourse(
      selectedCourse?.id,
      files.map((file) => ({ file, category: uploadCategory }))
    );
  }

  function handleReviewFileDragEnter(event) {
    if (reviewUploading) return;
    event.preventDefault();
    event.stopPropagation();
    reviewFileDragDepthRef.current += 1;
    setIsReviewFileDragActive(true);
  }

  function handleReviewFileDragOver(event) {
    if (reviewUploading) return;
    event.preventDefault();
    event.stopPropagation();
    if (!isReviewFileDragActive) setIsReviewFileDragActive(true);
  }

  function handleReviewFileDragLeave(event) {
    if (reviewUploading) return;
    event.preventDefault();
    event.stopPropagation();
    reviewFileDragDepthRef.current = Math.max(0, reviewFileDragDepthRef.current - 1);
    if (reviewFileDragDepthRef.current === 0) {
      setIsReviewFileDragActive(false);
    }
  }

  async function handleReviewFileDrop(event) {
    if (reviewUploading) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer?.files || []);
    await uploadFilesToReview(
      selectedReview?.id,
      files.map((file) => ({ file, category: reviewUploadCategory }))
    );
  }

  async function openStoredFile(fileMeta, download = false) {
    setBusyFileId(fileMeta.id);
    const openedWindow = download ? null : window.open("", "_blank", "noopener,noreferrer");
    try {
      let blob = null;
      let storagePath = fileMeta.storagePath || "";

      if (isSupabaseConfigured && supabase && isUuid(fileMeta.id)) {
        const { data: currentRow, error: fetchRowError } = await supabase
          .from("course_files")
          .select("storage_path")
          .eq("id", fileMeta.id)
          .maybeSingle();
        if (fetchRowError) throw fetchRowError;
        storagePath = currentRow?.storage_path || storagePath;
      }

      if (storagePath && isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath);
        if (!error && data) {
          blob = data;
        } else {
          const { data: signedData, error: signedUrlError } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60);
          if (signedUrlError) throw error || signedUrlError;
          if (download) {
            const link = document.createElement("a");
            link.href = signedData.signedUrl;
            link.download = fileMeta.name;
            document.body.appendChild(link);
            link.click();
            link.remove();
          } else if (openedWindow) {
            openedWindow.location.href = signedData.signedUrl;
          } else {
            window.open(signedData.signedUrl, "_blank", "noopener,noreferrer");
          }
          return;
        }
      } else {
        const record = await getFileRecord(fileMeta.id);
        if (!record?.blob) return;
        blob = new Blob([record.blob], { type: record.mime });
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileMeta.name;
      if (download) {
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        if (openedWindow) {
          openedWindow.location.href = url;
        } else {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
      }
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (error) {
      if (openedWindow && !openedWindow.closed) openedWindow.close();
      console.error("Failed to open course file.", error);
      window.alert(`文件操作失败。\n${error?.message || "请稍后重试。"}`);
    } finally {
      setBusyFileId(null);
    }
  }

  async function openStoredReviewFile(fileMeta, download = false) {
    setReviewBusyFileId(fileMeta.id);
    const openedWindow = download ? null : window.open("", "_blank", "noopener,noreferrer");
    try {
      let blob = null;
      let storagePath = fileMeta.storagePath || "";

      if (isSupabaseConfigured && supabase && isUuid(fileMeta.id)) {
        const { data: currentRow, error: fetchRowError } = await supabase
          .from("review_files")
          .select("storage_path")
          .eq("id", fileMeta.id)
          .maybeSingle();
        if (fetchRowError) throw fetchRowError;
        storagePath = currentRow?.storage_path || storagePath;
      }

      if (storagePath && isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath);
        if (!error && data) {
          blob = data;
        } else {
          const { data: signedData, error: signedUrlError } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60);
          if (signedUrlError) throw error || signedUrlError;
          if (download) {
            const link = document.createElement("a");
            link.href = signedData.signedUrl;
            link.download = fileMeta.name;
            document.body.appendChild(link);
            link.click();
            link.remove();
          } else if (openedWindow) {
            openedWindow.location.href = signedData.signedUrl;
          } else {
            window.open(signedData.signedUrl, "_blank", "noopener,noreferrer");
          }
          return;
        }
      } else {
        const record = await getFileRecord(fileMeta.id);
        if (!record?.blob) return;
        blob = new Blob([record.blob], { type: record.mime });
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileMeta.name;
      if (download) {
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        if (openedWindow) {
          openedWindow.location.href = url;
        } else {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
      }
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (error) {
      if (openedWindow && !openedWindow.closed) openedWindow.close();
      console.error("Failed to open review file.", error);
      window.alert(`文件操作失败。\n${error?.message || "请稍后重试。"}`);
    } finally {
      setReviewBusyFileId(null);
    }
  }

  async function removeFile(courseId, fileId) {
    const course = courses.find((item) => item.id === courseId);
    const targetFile = course?.files?.find((file) => file.id === fileId);
    try {
      if (targetFile?.storagePath && isSupabaseConfigured && supabase) {
        const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([targetFile.storagePath]);
        if (storageError) throw storageError;
        const { error: rowDeleteError } = await supabase.from("course_files").delete().eq("id", fileId);
        if (rowDeleteError) throw rowDeleteError;
      } else {
        await deleteFileRecord(fileId).catch(() => null);
      }
      await patchCourse(courseId, (currentCourse) => ({ ...currentCourse, files: (currentCourse.files || []).filter((file) => file.id !== fileId) }));
      showToast("文件已删除。");
    } catch (error) {
      console.error("Failed to remove course file.", error);
      window.alert(`删除文件失败。\n${error?.message || "请稍后重试。"}`);
    }
  }

  async function removeReviewFile(reviewId, fileId) {
    const reviewItem = reviews.find((entry) => entry.id === reviewId);
    const targetFile = reviewItem?.files?.find((file) => file.id === fileId);
    try {
      if (targetFile?.storagePath && isSupabaseConfigured && supabase) {
        const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([targetFile.storagePath]);
        if (storageError) throw storageError;
        const { error: rowDeleteError } = await supabase.from("review_files").delete().eq("id", fileId);
        if (rowDeleteError) throw rowDeleteError;
      } else {
        await deleteFileRecord(fileId).catch(() => null);
      }
      await patchReviewItem(reviewId, (item) => ({ ...item, files: (item.files || []).filter((file) => file.id !== fileId) }));
      showToast("复习文件已删除。");
    } catch (error) {
      console.error("Failed to remove review file.", error);
      window.alert(`删除文件失败。\n${error?.message || "请稍后重试。"}`);
    }
  }

  async function syncReviewFilesFromCourse(reviewId) {
    const reviewItem = reviews.find((item) => item.id === reviewId);
    if (!reviewItem) return;
    const sourceCourse = courses.find((course) => course.id === reviewItem.sourceCourseId);
    if (!sourceCourse) return;

    const existingSourceIds = new Set((reviewItem.files || []).map((file) => file.sourceFileId).filter(Boolean));
    const missingCourseFiles = (sourceCourse.files || []).filter((file) => !existingSourceIds.has(file.id));
    if (!missingCourseFiles.length) {
      showToast("复习文件已经与课程文件同步。");
      return;
    }

    setReviewUploading(true);
    try {
      const restoredFiles = [];
      for (const sourceFile of missingCourseFiles) {
        if (sourceFile.storagePath && isSupabaseConfigured && supabase) {
          const nextId = crypto.randomUUID();
          const targetPath = buildOwnedStoragePath("reviews", reviewId, nextId, sourceFile.name);
          const { error: copyError } = await supabase.storage.from(STORAGE_BUCKET).copy(sourceFile.storagePath, targetPath);
          if (copyError) throw copyError;
          const { error: insertError } = await supabase.from("review_files").insert({
            user_id: currentUserId,
            id: nextId,
            review_id: reviewId,
            source_file_id: isUuid(sourceFile.id) ? sourceFile.id : null,
            name: sourceFile.name,
            mime: sourceFile.mime || "",
            size: sourceFile.size || 0,
            category: sourceFile.category,
            storage_path: targetPath,
            reviewed: false,
            uploaded_at: sourceFile.uploadedAt || new Date().toISOString(),
          });
          if (insertError) throw insertError;
          restoredFiles.push({
            ...sourceFile,
            id: nextId,
            sourceFileId: sourceFile.id,
            reviewed: false,
            storagePath: targetPath,
          });
          continue;
        }

        const record = await getFileRecord(sourceFile.id).catch(() => null);
        if (!record?.blob) continue;
        const nextId = uid();
        const blob = new Blob([record.blob], { type: sourceFile.mime });
        await putFileRecord({
          id: nextId,
          reviewId,
          blob,
          name: sourceFile.name,
          mime: sourceFile.mime,
          size: sourceFile.size,
          uploadedAt: sourceFile.uploadedAt || new Date().toISOString(),
        });
        restoredFiles.push({
          ...sourceFile,
          id: nextId,
          sourceFileId: sourceFile.id,
          reviewed: false,
        });
      }
      if (restoredFiles.length) {
        patchReviewItem(reviewId, (item) => ({ ...item, files: [...restoredFiles, ...(item.files || [])] }));
        showToast(`已同步恢复 ${restoredFiles.length} 个课程文件。`);
      } else {
        showToast("课程文件没有可恢复的内容。");
      }
    } catch (error) {
      console.error("Failed to sync review files from course.", error);
      window.alert("同步复习文件失败。");
    } finally {
      setReviewUploading(false);
    }
  }

  function requestRemoveFile(courseId, fileId) {
    const course = courses.find((item) => item.id === courseId);
    const file = course?.files?.find((item) => item.id === fileId);
    requestConfirmation({
      title: "确认删除文件？",
      description: file ? `确定要删除文件“${file.name}”吗？` : "确定要删除这个文件吗？",
      onConfirm: () => removeFile(courseId, fileId),
    });
  }

  function requestRemoveReviewFile(reviewId, fileId) {
    const item = reviews.find((entry) => entry.id === reviewId);
    const file = item?.files?.find((entry) => entry.id === fileId);
    requestConfirmation({
      title: "确认删除文件？",
      description: file ? `确定要删除文件“${file.name}”吗？` : "确定要删除这个文件吗？",
      onConfirm: () => removeReviewFile(reviewId, fileId),
    });
  }

  if (isSupabaseConfigured && !authResolved) {
    return (
      <div className="min-h-screen bg-zinc-100 px-4 py-10 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-200 bg-white p-8 shadow-sm">
          <div className="text-xl font-semibold text-zinc-950">正在检查登录状态</div>
          <div className="mt-3 text-sm leading-6 text-zinc-500">请稍等，系统正在恢复当前账号会话并准备对应的数据空间。</div>
        </div>
      </div>
    );
  }

  if (isSupabaseConfigured && !currentUser) {
    return (
      <AuthScreen
        mode={authMode}
        form={authForm}
        error={authError}
        info={authInfo}
        busy={authSubmitting}
        captchaResetNonce={captchaResetNonce}
        onCaptchaChange={handleCaptchaChange}
        onChange={updateAuthForm}
        onSubmit={handleAuthSubmit}
        onSwitchMode={toggleAuthMode}
      />
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      {isSupabaseConfigured ? (
        <div ref={accountMenuRef} className="fixed right-3 top-3 z-[70] sm:right-6 sm:top-6">
          <MotionButton
            onClick={() => setShowAccountMenu((prev) => !prev)}
            className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-2.5 py-2 shadow-lg backdrop-blur hover:bg-white sm:gap-3 sm:px-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white">
              {(currentUsername || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden min-w-0 text-left sm:block">
              <div className="max-w-[150px] truncate text-sm font-semibold text-zinc-900">{currentUsername || "未命名用户"}</div>
              <div className="text-xs text-zinc-500">个人账户</div>
            </div>
            <ChevronDown className={classNames("h-4 w-4 text-zinc-500 transition", showAccountMenu ? "rotate-180" : "")} />
          </MotionButton>

          <AnimatePresence>
            {showAccountMenu ? (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="mt-3 w-[min(18rem,calc(100vw-1.5rem))] rounded-3xl border border-zinc-200 bg-white p-3.5 shadow-2xl sm:w-[280px] sm:p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-base font-semibold text-white">
                    {(currentUsername || "U").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-zinc-900">{currentUsername || "未命名用户"}</div>
                    <div className="text-xs leading-5 text-zinc-500">当前登录账户</div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-600">
                  退出当前账号后，会直接回到注册 / 登录页面。
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  <MotionButton
                    onClick={() => runWithStatusGuard(() => switchAccount())}
                    className="inline-flex items-center justify-center rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
                  >
                    切换账号
                  </MotionButton>
                  <MotionButton
                    onClick={() => runWithStatusGuard(() => logoutUser())}
                    className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    退出当前账号
                  </MotionButton>
                  <MotionButton
                    onClick={() => setShowAccountMenu(false)}
                    className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    关闭
                  </MotionButton>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        {!isBootstrapping && page === "overview" ? (
          <div className="mb-6 rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
                  <GraduationCap className="h-3.5 w-3.5" />
                  学期课程中心
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">学期课程总览与打卡</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                  学期范围：{TERM_START} - {TERM_END}。首页看总览，“本学期课程”与“复习模块”看详情，“课程状态”和“复习状态”看本周完成情况，“过往课程”和“过往复习”看历史内容。
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {!isBootstrapping ? (
          <div className="mb-6">
            <SectionCard title="页面导航" subtitle="这里保留所有页面入口，切换页面时会一直显示。">
              <div className="flex flex-wrap items-center gap-3">
                <NavTab active={page === "overview"} icon={<LayoutDashboard className="h-4 w-4" />} label="总览" onClick={() => navigateToPage("overview")} />
                <NavTab active={page === "courses" || page === "courseDetail"} icon={<BookOpen className="h-4 w-4" />} label="本学期课程" onClick={() => navigateToPage("courses")} />
                <NavTab active={page === "status"} icon={<CalendarDays className="h-4 w-4" />} label="课程状态" onClick={() => navigateToPage("status")} />
                <NavTab active={page === "reviews" || page === "reviewDetail"} icon={<ClipboardList className="h-4 w-4" />} label="复习模块" onClick={() => navigateToPage("reviews")} />
                <NavTab active={page === "reviewStatus"} icon={<CheckCircle2 className="h-4 w-4" />} label="复习状态" onClick={() => navigateToPage("reviewStatus")} />
                <NavTab active={page === "archive"} icon={<Archive className="h-4 w-4" />} label="过往课程" onClick={() => navigateToPage("archive")} />
                <NavTab active={page === "reviewArchive"} icon={<Archive className="h-4 w-4" />} label="过往复习" onClick={() => navigateToPage("reviewArchive")} />
              </div>
            </SectionCard>
          </div>
        ) : null}

        <AnimatePresence>
          {hasUnsavedStatusChanges ? (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.18 }}
              className="sticky top-4 z-40 mb-6 rounded-[2rem] border border-amber-200 bg-amber-50/95 p-4 shadow-sm backdrop-blur"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-amber-900">你有未保存的状态修改</div>
                  <div className="mt-1 text-sm text-amber-800">
                    已修改 {allStatusDraftSummary.fieldCount} 项状态，其中课程 {allStatusDraftSummary.courseFieldCount} 项，复习 {allStatusDraftSummary.reviewFieldCount} 项。
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <MotionButton
                    onClick={discardAllStatusChanges}
                    className="rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-100"
                  >
                    放弃修改
                  </MotionButton>
                  <MotionButton
                    onClick={saveAllStatusChanges}
                    className="rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
                  >
                    保存状态
                  </MotionButton>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {isBootstrapping ? (
          <SectionCard title="正在加载数据" subtitle={isSupabaseConfigured ? "正在从云端读取课程与复习数据。" : "正在读取本地课程与复习数据。"}>
            <div className="text-sm text-zinc-500">请稍等，页面数据正在初始化。</div>
          </SectionCard>
        ) : null}

        {!isBootstrapping && isMigratingLegacyFiles ? (
          <SectionCard title="正在迁移旧文件" subtitle="检测到浏览器里还有历史本地文件，正在上传到云端。">
            <div className="text-sm text-zinc-500">迁移完成后，旧文件也会和新文件一样长期保存在 Supabase Storage 中。</div>
          </SectionCard>
        ) : null}

        {!isBootstrapping && page === "overview" ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatCard icon={<BookOpen className="h-5 w-5" />} label="本学期课程" value={stats.activeCount} helper="当前学期正在进行的课程" onClick={() => navigateToPage("courses")} />
              <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="课程本周已完成" value={stats.bothDone} helper={`当前周：${currentWeekLabel}`} onClick={() => navigateToPage("status")} />
              <StatCard icon={<ClipboardList className="h-5 w-5" />} label="课程本周未完成" value={stats.unfinished} helper="上课或作业仍未完成" onClick={() => navigateToPage("status")} />
              <StatCard icon={<ClipboardList className="h-5 w-5" />} label="复习条目" value={reviewStats.count} helper={`待复习：${reviewStats.pending} · 已归档：${reviewStats.archivedCount}`} onClick={() => navigateToPage("reviews")} />
              <StatCard icon={<FileText className="h-5 w-5" />} label="资料总数" value={stats.filesCount + reviewStats.filesCount} helper={`已归档课程：${stats.archivedCount}`} onClick={() => navigateToPage("courses")} />
            </div>

            <SectionCard title="本周提醒" subtitle="这里只显示当前周还没完成的内容。">
              {stats.unfinished > 0 ? (
                <div className="space-y-3">
                  {weeklyOverviewRows
                    .filter((course) => !(course.currentRecord?.lectureDone && course.currentRecord?.homeworkDone))
                    .map((course) => (
                      <div key={course.id} className="rounded-3xl border border-rose-200 bg-rose-50 p-4">
                        <div className="font-medium text-zinc-900">{course.name}</div>
                        <div className="mt-1 text-sm text-zinc-600">{getEntityScheduleLabel(course) || "时间待定"}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {!course.currentRecord?.lectureDone ? <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-rose-700">这周还没上课</span> : null}
                          {!course.currentRecord?.homeworkDone ? <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-rose-700">这周作业还没完成</span> : null}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <EmptyState title="本周都完成了" description="当前学期的课程本周都已经打卡完成。" />
              )}
            </SectionCard>
          </div>
        ) : null}

        {!isBootstrapping && page === "status" ? (
          <SectionCard
            title={
              <span className="inline-flex flex-wrap items-center gap-3">
                <span>课程状态</span>
                <MotionButton
                  onClick={openStatusHistoryModalPanel}
                  disabled={!previousWeekNumber}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CalendarDays className="h-4 w-4" />
                  查看过往周
                </MotionButton>
              </span>
            }
            subtitle={`当前周：${currentWeekLabel}。你可以在这里修改本周状态，也可以通过“查看过往周”进入历史周次的浮层。${hasUnsavedCourseStatusChanges ? ` 当前还有 ${statusDraftSummary.fieldCount} 项课程状态修改未保存。` : ""}`}
            right={
              <StatusActionBar
                hasUnsavedStatusChanges={hasUnsavedCourseStatusChanges}
                changedCount={statusDraftSummary.fieldCount}
                onDiscard={discardStatusChanges}
                onSave={saveStatusChanges}
                sticky
              />
            }
          >
            {weeklyOverviewRows.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-left text-sm text-zinc-500">
                      <th className="px-3">课程</th>
                      <th className="px-3">时间</th>
                      <th className="px-3">Vorlesung</th>
                      <th className="px-3">Hausaufgabe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyOverviewRows.map((course) => {
                      const lectureDone = Boolean(course.currentRecord?.lectureDone);
                      const homeworkDone = Boolean(course.currentRecord?.homeworkDone);
                      return (
                        <tr key={course.id} className="bg-zinc-50 text-sm shadow-sm">
                          <td className="rounded-l-3xl px-3 py-4 align-middle">
                            <div className="font-semibold text-zinc-900">{course.name}</div>
                            <div className="mt-1 text-xs text-zinc-500">{course.kind}</div>
                          </td>
                          <td className="px-3 py-4 align-middle text-zinc-600">
                            <div>{getEntityScheduleLabel(course) || "时间待定"}</div>
                          </td>
                          <td className="px-3 py-4 align-middle">
                            <StatusPill done={lectureDone} doneLabel="已上" todoLabel="未上" onClick={() => toggleWeeklyField(course.id, currentWeekNumber, "lectureDone")} />
                          </td>
                          <td className="rounded-r-3xl px-3 py-4 align-middle">
                            <StatusPill done={homeworkDone} doneLabel="已写" todoLabel="未写" onClick={() => toggleWeeklyField(course.id, currentWeekNumber, "homeworkDone")} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="还没有课程" description="先导入模板课程，或者手动新建一门课程。" />
            )}
          </SectionCard>
        ) : null}

        {!isBootstrapping && page === "courses" ? (
          <SectionCard
            title="本学期课程"
            subtitle="列表页展示课程概览，并支持按星期、完成状态、文件情况筛选。点击“查看”进入单独的课程详情页。"
            right={
              <ToolbarRow>
                <MotionButton
                  onClick={() => setShowCourseSearchModal(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:min-w-[13rem] sm:w-auto"
                >
                  <Search className="h-4 w-4" />
                  {query || weekdayFilter !== "全部星期" || unfinishedOnly || hasFilesOnly ? "搜索与筛选中" : "搜索与筛选"}
                </MotionButton>
                <MotionButton
                  onClick={() => startCourseBulkMode("archive")}
                  className={classNames(
                    "w-full rounded-2xl px-3 py-3 text-sm font-medium transition sm:w-auto",
                    courseBulkMode === "archive" ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  )}
                >
                  批量归档
                </MotionButton>
                <MotionButton
                  onClick={() => startCourseBulkMode("delete")}
                  className={classNames(
                    "w-full rounded-2xl px-3 py-3 text-sm font-medium transition sm:w-auto",
                    courseBulkMode === "delete" ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  )}
                >
                  批量删除
                </MotionButton>
                <MotionButton onClick={openCreateModal} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-3 py-3 text-sm font-medium text-white hover:bg-zinc-800 sm:w-auto">
                  <Plus className="h-4 w-4" />
                  新建
                </MotionButton>
              </ToolbarRow>
            }
          >
            <div className="space-y-4">
              {courseBulkMode ? (
                <BulkActionBar
                  mode={courseBulkMode}
                  count={selectedCourseIdsForBatchDelete.length}
                  totalCount={filteredCourses.length}
                  onToggleAll={toggleSelectAllCourses}
                  onSubmit={courseBulkMode === "delete" ? requestDeleteSelectedCourses : requestArchiveSelectedCourses}
                  onCancel={cancelCourseBulkMode}
                />
              ) : null}
              {filteredCourses.length ? (
                filteredCourses.map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    currentWeekNumber={currentWeekNumber}
                    selected={selectedCourseId === course.id}
                    onOpen={() => openCourse(course.id)}
                    onEdit={() => openEditModal(course)}
                    onDelete={() => requestDeleteCourse(course.id)}
                    onArchive={() => requestArchiveCourse(course.id)}
                    bulkMode={courseBulkMode}
                    checked={selectedCourseIdsForBatchDelete.includes(course.id)}
                    onToggleSelect={() => toggleCourseBatchSelection(course.id)}
                  />
                ))
              ) : (
                <EmptyState title="没有匹配课程" description="可以清空搜索，或者新建一门课程。" />
              )}
            </div>
          </SectionCard>
        ) : null}

        {!isBootstrapping && page === "courseDetail" ? (
          selectedCourse ? (
            <div className="space-y-6">
              <SectionCard
                title="课程详情"
                subtitle="保留本周状态和本周摘要在当前页面，其余模块点击后会在浮层里展开。"
                right={
                  <MotionButton onClick={() => navigateToPage("courses")} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:w-auto">
                    <ArrowLeft className="h-4 w-4" />
                    返回课程列表
                  </MotionButton>
                }
              >
                <div className="rounded-[2rem] border border-zinc-200 bg-zinc-50 p-4 sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="mb-2 inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-600">{selectedCourse.kind}</div>
                      <h2 className="text-2xl font-semibold text-zinc-950">{selectedCourse.name}</h2>
                      <p className="mt-2 text-sm text-zinc-500">
                        {getEntityScheduleLabel(selectedCourse) || "时间待定"}
                        {selectedCourse.room ? ` · ${selectedCourse.room}` : ""}
                        {selectedCourse.teacher ? ` · ${selectedCourse.teacher}` : ""}
                      </p>
                    </div>
                    <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3">
                      <MotionButton onClick={() => openEditModal(selectedCourse)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                        <Pencil className="h-4 w-4" />
                        编辑
                      </MotionButton>
                      <MotionButton onClick={() => requestArchiveCourse(selectedCourse.id)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                        <Archive className="h-4 w-4" />
                        归档
                      </MotionButton>
                      <MotionButton onClick={() => requestDeleteCourse(selectedCourse.id)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                        删除
                      </MotionButton>
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="本周状态"
                subtitle={`当前周：${currentWeekLabel}`}
                right={
                  <StatusActionBar
                    hasUnsavedStatusChanges={hasUnsavedCourseStatusChanges}
                    changedCount={statusDraftSummary.fieldCount}
                    onDiscard={discardStatusChanges}
                    onSave={saveStatusChanges}
                    sticky
                  />
                }
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-medium text-zinc-500">上课状态</div>
                    <div className="mt-3">
                      <StatusPill
                        done={Boolean(selectedCourseCurrentRecord?.lectureDone)}
                        doneLabel="本周已上课"
                        todoLabel="本周未上课"
                        onClick={() => toggleWeeklyField(selectedCourse.id, currentWeekNumber, "lectureDone")}
                      />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-medium text-zinc-500">作业状态</div>
                    <div className="mt-3">
                      <StatusPill
                        done={Boolean(selectedCourseCurrentRecord?.homeworkDone)}
                        doneLabel="本周已写作业"
                        todoLabel="本周未写作业"
                        onClick={() => toggleWeeklyField(selectedCourse.id, currentWeekNumber, "homeworkDone")}
                      />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-medium text-zinc-500">总体状态</div>
                    <div className={classNames("mt-3 inline-flex rounded-full px-3 py-2 text-sm font-medium", selectedCourseCurrentRecord?.lectureDone && selectedCourseCurrentRecord?.homeworkDone ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                      {selectedCourseCurrentRecord?.lectureDone && selectedCourseCurrentRecord?.homeworkDone ? "本周已全部完成" : "本周还有待完成项"}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="本周摘要" subtitle="简要看一下这门课本周待办和最近一份资料。">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-sm font-semibold text-zinc-900">本周待办</div>
                    {selectedCourseTodoItems.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedCourseTodoItems.map((item) => (
                          <span key={item} className="rounded-full bg-rose-100 px-3 py-2 text-xs font-medium text-rose-700">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl bg-emerald-100 px-3 py-3 text-sm font-medium text-emerald-700">本周这门课已经全部完成。</div>
                    )}
                  </div>
                  <MotionButton
                    onClick={() => setActiveCourseDetailPanel("recent")}
                    className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4 text-left transition hover:border-zinc-300 hover:bg-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-zinc-900">最近上传</div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">{selectedCourseRecentFiles.length} 个文件</span>
                    </div>
                    {latestSelectedCourseFile ? (
                      <div className="mt-3 flex items-center gap-3">
                        <FileCoverThumbnail file={latestSelectedCourseFile} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-900">{latestSelectedCourseFile.name}</div>
                          <div className="mt-1 text-xs text-zinc-500">{latestSelectedCourseFile.category} · {formatDateTime(latestSelectedCourseFile.uploadedAt)}</div>
                          <div className="mt-2 text-xs font-medium text-zinc-600">点击查看最近上传文件</div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-zinc-500">这门课还没有上传过资料。</div>
                    )}
                  </MotionButton>
                </div>
              </SectionCard>

              <SectionCard title="更多模块" subtitle="除本周状态和本周摘要外，其余内容都收进这里。点击卡片后会在浮层里展开。">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <DetailModuleCard
                    icon={<BookOpen className="h-5 w-5" />}
                    title="当前信息"
                    description="查看课程名称、教师、星期、时间和地点。"
                    meta="基础信息"
                    onClick={() => setActiveCourseDetailPanel("info")}
                  />
                  <DetailModuleCard
                    icon={<FileText className="h-5 w-5" />}
                    title="课程文件"
                    description="上传和管理课程资料，文件分类默认收起。"
                    meta={`${selectedCourse.files?.length || 0} 个文件`}
                    onClick={() => setActiveCourseDetailPanel("files")}
                  />
                  <DetailModuleCard
                    icon={<CalendarDays className="h-5 w-5" />}
                    title="每周记录"
                    description="按周查看和修改上课、作业完成状态。"
                    meta={`${selectedCourse.weeklyRecords.length} 周`}
                    onClick={() => setActiveCourseDetailPanel("records")}
                  />
                </div>
              </SectionCard>
            </div>
          ) : (
            <EmptyState
              title="没有可查看的课程"
              description="这门课程可能已经被归档或删除。"
              action={
                <MotionButton onClick={() => navigateToPage("courses")} className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800">
                  <ArrowLeft className="h-4 w-4" />
                  返回课程列表
                </MotionButton>
              }
            />
          )
        ) : null}

        {!isBootstrapping && page === "reviews" ? (
          <SectionCard
            title="复习模块"
            subtitle="这里管理所有复习条目。新建时直接从本学期课程里选择，并复制课程文件作为复习文件。"
            right={
              <ToolbarRow>
                <MotionButton
                  onClick={() => setShowReviewSearchModal(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:min-w-[13rem] sm:w-auto"
                >
                  <Search className="h-4 w-4" />
                  {reviewQuery || reviewWeekdayFilter !== "全部星期" || reviewUnfinishedOnly || reviewHasFilesOnly ? "搜索与筛选中" : "搜索与筛选"}
                </MotionButton>
                <MotionButton
                  onClick={() => startReviewBulkMode("archive")}
                  className={classNames(
                    "w-full rounded-2xl px-3 py-3 text-sm font-medium transition sm:w-auto",
                    reviewBulkMode === "archive" ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  )}
                >
                  批量归档
                </MotionButton>
                <MotionButton
                  onClick={() => startReviewBulkMode("delete")}
                  className={classNames(
                    "w-full rounded-2xl px-3 py-3 text-sm font-medium transition sm:w-auto",
                    reviewBulkMode === "delete" ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  )}
                >
                  批量删除
                </MotionButton>
                <MotionButton onClick={openReviewModal} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-3 py-3 text-sm font-medium text-white hover:bg-zinc-800 sm:w-auto">
                  <Plus className="h-4 w-4" />
                  从课程新建
                </MotionButton>
              </ToolbarRow>
            }
          >
            <div className="space-y-4">
              {reviewBulkMode ? (
                <BulkActionBar
                  mode={reviewBulkMode}
                  count={selectedReviewIdsForBatchDelete.length}
                  totalCount={filteredReviewItems.length}
                  onToggleAll={toggleSelectAllReviews}
                  onSubmit={reviewBulkMode === "delete" ? requestDeleteSelectedReviews : requestArchiveSelectedReviews}
                  onCancel={cancelReviewBulkMode}
                />
              ) : null}
              {filteredReviewItems.length ? (
                filteredReviewItems.map((item) => (
                  <ReviewCard
                    key={item.id}
                    item={item}
                    selected={selectedReviewId === item.id}
                    onOpen={() => openReviewItem(item.id)}
                    onDelete={() => requestDeleteReviewItem(item.id)}
                    onArchive={() => requestArchiveReviewItem(item.id)}
                    bulkMode={reviewBulkMode}
                    checked={selectedReviewIdsForBatchDelete.includes(item.id)}
                    onToggleSelect={() => toggleReviewBatchSelection(item.id)}
                  />
                ))
              ) : (
                <EmptyState title="还没有复习条目" description="可以新建一条复习计划，整理每周要复习的内容和资料。" />
              )}
            </div>
          </SectionCard>
        ) : null}

        {!isBootstrapping && page === "reviewStatus" ? (
          <SectionCard
            title="复习状态"
            subtitle="这里集中展示每个复习条目的当前复习进度。进度达到 100% 时会自动视为已复习。"
          >
            {reviewOverviewRows.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-left text-sm text-zinc-500">
                      <th className="px-3">复习条目</th>
                      <th className="px-3">时间</th>
                      <th className="px-3">复习进度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewOverviewRows.map((item) => {
                      const reviewDone = item.progress === 100;
                      return (
                        <tr key={item.id} className="bg-zinc-50 text-sm shadow-sm">
                          <td className="rounded-l-3xl px-3 py-4 align-middle">
                            <div className="font-semibold text-zinc-900">{item.name}</div>
                            <div className="mt-1 text-xs text-zinc-500">{item.subject || "未分类"}</div>
                          </td>
                          <td className="px-3 py-4 align-middle text-zinc-600">
                            <div>{getEntityScheduleLabel(item) || "时间待定"}</div>
                          </td>
                          <td className="rounded-r-3xl px-3 py-4 align-middle">
                            <div className="font-medium text-zinc-900">{item.progress}%</div>
                            <div className={classNames("mt-1 text-xs", reviewDone ? "text-emerald-700" : "text-zinc-500")}>{reviewDone ? "已复习" : "未复习"}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="还没有复习条目" description="先创建复习条目，然后在这里集中打卡。" />
            )}
          </SectionCard>
        ) : null}

        {!isBootstrapping && page === "reviewDetail" ? (
          selectedReview ? (
            <div className="space-y-6">
              <SectionCard
                title="复习详情"
                subtitle="复习相关内容已整理成模块入口，点击卡片后会在浮层里展开。"
                right={
                  <MotionButton onClick={() => navigateToPage("reviews")} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:w-auto">
                    <ArrowLeft className="h-4 w-4" />
                    返回复习列表
                  </MotionButton>
                }
              >
                <div className="rounded-[2rem] border border-zinc-200 bg-zinc-50 p-4 sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="mb-2 inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-600">{selectedReview.subject || "复习条目"}</div>
                      <h2 className="text-2xl font-semibold text-zinc-950">{selectedReview.name}</h2>
                      <p className="mt-2 text-sm text-zinc-500">
                        {getEntityScheduleLabel(selectedReview) || "时间待定"}
                        {selectedReview.room ? ` · ${selectedReview.room}` : ""}
                      </p>
                    </div>
                    <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
                      {!selectedReview.archived ? (
                        <>
                          <MotionButton onClick={() => requestArchiveReviewItem(selectedReview.id)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                            <Archive className="h-4 w-4" />
                            归档
                          </MotionButton>
                        </>
                      ) : (
                        <MotionButton onClick={() => restoreReviewItem(selectedReview.id)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                          <RotateCcw className="h-4 w-4" />
                          恢复
                        </MotionButton>
                      )}
                      <MotionButton onClick={() => requestDeleteReviewItem(selectedReview.id)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                        删除
                      </MotionButton>
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="复习模块" subtitle="复习详情里的内容也收进模块卡片里，点击后在浮层查看。">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <DetailModuleCard
                    icon={<CheckCircle2 className="h-5 w-5" />}
                    title="复习进度"
                    description="查看当前进度、已复习文件数和整体状态。"
                    meta={`${selectedReviewProgress}%`}
                    onClick={() => setActiveReviewDetailPanel("progress")}
                  />
                  <DetailModuleCard
                    icon={<Upload className="h-5 w-5" />}
                    title="最近上传"
                    description="只看这条复习最近新增的文件记录。"
                    meta={`${selectedReviewRecentFiles.length} 个最近文件`}
                    onClick={() => setActiveReviewDetailPanel("recent")}
                  />
                  <DetailModuleCard
                    icon={<FileText className="h-5 w-5" />}
                    title="复习文件"
                    description="查看、上传、同步和打卡复习文件。"
                    meta={`${selectedReview.files?.length || 0} 个文件`}
                    onClick={() => setActiveReviewDetailPanel("files")}
                  />
                </div>
              </SectionCard>
            </div>
          ) : (
            <EmptyState
              title="没有可查看的复习条目"
              description="这条复习可能已经被删除。"
              action={
                <MotionButton onClick={() => navigateToPage("reviews")} className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800">
                  <ArrowLeft className="h-4 w-4" />
                  返回复习列表
                </MotionButton>
              }
            />
          )
        ) : null}

        {!isBootstrapping && page === "archive" ? (
          <SectionCard
            title="过往课程"
            subtitle="已归档课程会放在这里，之后也可以恢复。支持按关键词和星期筛选。"
            right={
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={archiveQuery}
                    onChange={(e) => setArchiveQuery(e.target.value)}
                    placeholder="搜索过往课程"
                    className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
                  />
                </div>
                <select
                  value={archiveWeekdayFilter}
                  onChange={(e) => setArchiveWeekdayFilter(e.target.value)}
                  className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
                >
                  <option>全部星期</option>
                  {DAY_ORDER.map((day) => (
                    <option key={day}>{day}</option>
                  ))}
                </select>
              </div>
            }
          >
            {filteredArchivedCourses.length ? (
              <div className="space-y-4">
                {filteredArchivedCourses.map((course) => (
                  <div key={course.id} className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-lg font-semibold text-zinc-900">{course.name}</div>
                        <div className="mt-1 text-sm text-zinc-500">{getEntityScheduleLabel(course) || "时间待定"} · {course.kind}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <MotionButton onClick={() => restoreCourse(course.id)} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                          <RotateCcw className="h-4 w-4" />
                          恢复
                        </MotionButton>
                        <MotionButton onClick={() => requestDeleteCourse(course.id)} className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                          删除
                        </MotionButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="没有匹配的过往课程" description="可以清空搜索或切换星期筛选。" />
            )}
          </SectionCard>
        ) : null}

        {!isBootstrapping && page === "reviewArchive" ? (
          <SectionCard
            title="过往复习"
            subtitle="这里展示已经归档的复习条目。可以按关键词和星期筛选。"
            right={
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={reviewArchiveQuery}
                    onChange={(e) => setReviewArchiveQuery(e.target.value)}
                    placeholder="搜索过往复习"
                    className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
                  />
                </div>
              </div>
            }
          >
            {filteredArchivedReviewItems.length ? (
              <div className="space-y-4">
                {filteredArchivedReviewItems.map((item) => (
                  <div key={item.id} className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-lg font-semibold text-zinc-900">{item.name}</div>
                        <div className="mt-1 text-sm text-zinc-500">{getEntityScheduleLabel(item) || "时间待定"} · {item.subject || "复习条目"}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-emerald-100 px-3 py-2 text-xs font-medium text-emerald-700">{calcReviewProgress(item)}%</span>
                        <MotionButton onClick={() => restoreReviewItem(item.id)} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                          <RotateCcw className="h-4 w-4" />
                          恢复
                        </MotionButton>
                        <MotionButton onClick={() => openReviewItem(item.id)} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                          <Eye className="h-4 w-4" />
                          查看
                        </MotionButton>
                        <MotionButton onClick={() => requestDeleteReviewItem(item.id)} className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                          删除
                        </MotionButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="还没有过往复习" description="归档后的复习条目会显示在这里。" />
            )}
          </SectionCard>
        ) : null}
      </div>

      <Modal
        open={Boolean(selectedCourse && activeCourseDetailPanel)}
        onClose={() => setActiveCourseDetailPanel(null)}
        title={
          activeCourseDetailPanel === "info"
            ? "当前信息"
            : activeCourseDetailPanel === "files"
              ? "课程文件"
              : activeCourseDetailPanel === "recent"
                ? "最近上传"
                : activeCourseDetailPanel === "records"
                  ? "每周记录"
                  : "课程详情"
        }
        panelClassName="max-w-5xl"
      >
        {activeCourseDetailPanel === "info" ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">这些信息与新建课程时填写的字段一致。</p>
            {courseInfoContent}
          </div>
        ) : null}
        {activeCourseDetailPanel === "files" ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">上传和管理当前课程的文件都放在这里。所有分类默认收起，按需展开即可。</p>
            {courseFilesContent}
          </div>
        ) : null}
        {activeCourseDetailPanel === "recent" ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">这里展示这门课最近上传的文件列表。</p>
            {selectedCourseRecentFiles.length ? (
              <div className="space-y-3">
                {selectedCourseRecentFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4">
                    <FileCoverThumbnail file={file} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-900">{file.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">{file.category} · {formatDateTime(file.uploadedAt)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <MotionButton
                        onClick={() => openStoredFile(file, false)}
                        disabled={busyFileId === file.id}
                        className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        打开
                      </MotionButton>
                      <MotionButton
                        onClick={() => openStoredFile(file, true)}
                        disabled={busyFileId === file.id}
                        className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        下载
                      </MotionButton>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-500">这门课还没有上传过资料。</div>
            )}
          </div>
        ) : null}
        {activeCourseDetailPanel === "records" ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm text-zinc-500">按周切换上课与作业完成状态。</p>
              <StatusActionBar
                hasUnsavedStatusChanges={hasUnsavedCourseStatusChanges}
                changedCount={statusDraftSummary.fieldCount}
                onDiscard={discardStatusChanges}
                onSave={saveStatusChanges}
              />
            </div>
            {courseWeeklyRecordsContent}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(selectedReview && activeReviewDetailPanel)}
        onClose={() => setActiveReviewDetailPanel(null)}
        title={
          activeReviewDetailPanel === "progress"
            ? "复习进度"
            : activeReviewDetailPanel === "recent"
              ? "最近上传"
              : activeReviewDetailPanel === "files"
                ? "复习文件"
                : "复习详情"
        }
        panelClassName="max-w-5xl"
      >
        {activeReviewDetailPanel === "progress" ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">每看完一个复习文件，就可以把它标记为已复习，进度会自动增长。</p>
            {reviewProgressContent}
          </div>
        ) : null}
        {activeReviewDetailPanel === "recent" ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">保留最近新增到这条复习里的文件记录。</p>
            {reviewRecentFilesContent}
          </div>
        ) : null}
        {activeReviewDetailPanel === "files" ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">这些文件来自对应课程，分类保持一致。你可以逐个标记是否已经复习，也可以额外上传复习资料。</p>
            {reviewFilesContent}
          </div>
        ) : null}
      </Modal>

      <Modal open={showCreateModal} onClose={closeCourseModal} title={editingCourseId ? "编辑课程" : "新建课程"}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-zinc-700">课程名称</div>
            <input
              value={createForm.name}
              onChange={(e) => updateCourseForm("name", e.target.value)}
              placeholder="例如：Maschinelles Lernen"
              className={classNames(
                "w-full rounded-2xl border bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:bg-white",
                courseFormErrors.name ? "border-rose-300 focus:border-rose-400" : "border-zinc-200 focus:border-zinc-400"
              )}
            />
            {courseFormErrors.name ? <div className="mt-2 text-xs font-medium text-rose-600">{courseFormErrors.name}</div> : null}
          </label>
          <label className="block">
            <div className="mb-2 text-sm font-medium text-zinc-700">授课教师</div>
            <input
              value={createForm.teacher}
              onChange={(e) => updateCourseForm("teacher", e.target.value)}
              placeholder="例如：Prof. Müller"
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
            />
          </label>
          <label className="block">
            <div className="mb-2 text-sm font-medium text-zinc-700">课程类型</div>
            <select
              value={createForm.kind}
              onChange={(e) => updateCourseForm("kind", e.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
            >
              <option>Vorlesung</option>
              <option>Seminar</option>
              <option>Übung</option>
              <option>Kolloquium</option>
              <option>Praktikum</option>
            </select>
          </label>
          <div className="block md:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-zinc-700">上课安排</div>
              <MotionButton
                type="button"
                onClick={addCourseScheduleEntry}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <Plus className="h-4 w-4" />
                添加一条时间
              </MotionButton>
            </div>
            <div className={classNames("space-y-3 rounded-2xl border bg-zinc-50 p-3", courseFormErrors.scheduleEntries ? "border-rose-300" : "border-zinc-200")}>
              {(createForm.scheduleEntries || []).map((entry, index) => (
                <div key={`${entry.weekday}-${index}`} className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-3 md:grid-cols-[180px_minmax(0,1fr)_auto]">
                  <select
                    value={entry.weekday}
                    onChange={(e) => updateCourseScheduleEntry(index, "weekday", e.target.value)}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
                  >
                    {DAY_ORDER.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                  <input
                    value={entry.time}
                    onChange={(e) => updateCourseScheduleEntry(index, "time", e.target.value)}
                    placeholder="xx:xx - xx:xx"
                    inputMode="numeric"
                    className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
                  />
                  <MotionButton
                    type="button"
                    onClick={() => removeCourseScheduleEntry(index)}
                    disabled={(createForm.scheduleEntries || []).length <= 1}
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    删除
                  </MotionButton>
                </div>
              ))}
            </div>
            <div className={classNames("mt-2 text-xs", courseFormErrors.scheduleEntries ? "font-medium text-rose-600" : "text-zinc-500")}>
              {courseFormErrors.scheduleEntries || "每条上课安排都可以设置不同的星期和时间。直接输入数字即可自动补全成 xx:xx - xx:xx。"}
            </div>
          </div>
          <label className="block">
            <div className="mb-2 text-sm font-medium text-zinc-700">教室 / 地点</div>
            <input
              value={createForm.room}
              onChange={(e) => updateCourseForm("room", e.target.value)}
              placeholder="例如：S 006 · Schellingstr. 3"
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
            />
          </label>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <MotionButton onClick={closeCourseModal} className="rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            取消
          </MotionButton>
          <MotionButton onClick={saveCourse} disabled={isSavingCourse} className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400">
            {editingCourseId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isSavingCourse ? "保存中..." : editingCourseId ? "保存修改" : "创建课程"}
          </MotionButton>
        </div>
      </Modal>
      <Modal open={showCourseSearchModal} onClose={() => setShowCourseSearchModal(false)} title="搜索课程">
        <div className="space-y-4">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-zinc-700">关键词</div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="课程名、教师、类型"
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
            />
          </label>
          <label className="block">
            <div className="mb-2 text-sm font-medium text-zinc-700">星期</div>
            <select
              value={weekdayFilter}
              onChange={(e) => setWeekdayFilter(e.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
            >
              <option>全部星期</option>
              {DAY_ORDER.map((day) => (
                <option key={day}>{day}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <MotionButton onClick={() => setUnfinishedOnly((prev) => !prev)} className={classNames("rounded-2xl px-3 py-3 text-sm font-medium transition", unfinishedOnly ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50")}>
              只看未完成
            </MotionButton>
            <MotionButton onClick={() => setHasFilesOnly((prev) => !prev)} className={classNames("rounded-2xl px-3 py-3 text-sm font-medium transition", hasFilesOnly ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50")}>
              只看有文件
            </MotionButton>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <MotionButton onClick={resetCourseFilters} className="rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              清空条件
            </MotionButton>
            <MotionButton onClick={() => setShowCourseSearchModal(false)} className="rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800">
              搜索
            </MotionButton>
          </div>
        </div>
      </Modal>
      <Modal open={showReviewModal} onClose={closeReviewModal} title="从课程新建复习条目">
        <div className="space-y-4">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-zinc-700">选择课程</div>
            <select
              value={reviewForm.sourceCourseId}
              onChange={(e) => updateReviewForm("sourceCourseId", e.target.value)}
              className={classNames(
                "w-full rounded-2xl border bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:bg-white",
                reviewFormErrors.sourceCourseId ? "border-rose-300 focus:border-rose-400" : "border-zinc-200 focus:border-zinc-400"
              )}
            >
              <option value="">请选择一门课程</option>
              {availableReviewCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name} · {getEntityScheduleLabel(course) || "时间待定"}
                </option>
              ))}
            </select>
            {reviewFormErrors.sourceCourseId ? <div className="mt-2 text-xs font-medium text-rose-600">{reviewFormErrors.sourceCourseId}</div> : null}
          </label>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
            新建后会自动复制这门课当前的所有课程文件到复习条目里，并保留原有分类。之后你可以在复习详情里逐个文件标记“已复习 / 未复习”。
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <MotionButton onClick={closeReviewModal} className="rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            取消
          </MotionButton>
          <MotionButton onClick={saveReviewItem} disabled={isSavingReview} className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400">
            <Plus className="h-4 w-4" />
            {isSavingReview ? "创建中..." : "创建复习条目"}
          </MotionButton>
        </div>
      </Modal>
      <Modal open={showReviewSearchModal} onClose={() => setShowReviewSearchModal(false)} title="搜索复习">
        <div className="space-y-4">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-zinc-700">关键词</div>
            <input
              value={reviewQuery}
              onChange={(e) => setReviewQuery(e.target.value)}
              placeholder="复习条目、分类、地点"
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
            />
          </label>
          <label className="block">
            <div className="mb-2 text-sm font-medium text-zinc-700">星期</div>
            <select
              value={reviewWeekdayFilter}
              onChange={(e) => setReviewWeekdayFilter(e.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
            >
              <option>全部星期</option>
              {DAY_ORDER.map((day) => (
                <option key={day}>{day}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <MotionButton onClick={() => setReviewUnfinishedOnly((prev) => !prev)} className={classNames("rounded-2xl px-3 py-3 text-sm font-medium transition", reviewUnfinishedOnly ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50")}>
              只看未复习
            </MotionButton>
            <MotionButton onClick={() => setReviewHasFilesOnly((prev) => !prev)} className={classNames("rounded-2xl px-3 py-3 text-sm font-medium transition", reviewHasFilesOnly ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50")}>
              只看有文件
            </MotionButton>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <MotionButton onClick={resetReviewFilters} className="rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              清空条件
            </MotionButton>
            <MotionButton onClick={() => setShowReviewSearchModal(false)} className="rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800">
              搜索
            </MotionButton>
          </div>
        </div>
      </Modal>
      <Modal open={showStatusHistoryModal} onClose={closeStatusHistoryModalPanel} title="过往周状态" panelClassName="max-w-4xl">
        <div className="space-y-4">
          <p className="text-sm leading-6 text-zinc-500">点击任意周次后，会打开对应周的课程状态浮层。你可以在那里继续查看并修改那一周的上课和作业完成情况。</p>
          {statusHistoryWeeks.length ? (
            <div className="space-y-3">
              {statusHistoryWeeks.map((week) => (
                <MotionButton
                  key={week.weekNumber}
                  onClick={() => openStatusHistoryWeekDetail(week.weekNumber)}
                  className="w-full rounded-3xl border border-zinc-200 bg-zinc-50 p-4 text-left hover:border-zinc-300 hover:bg-white"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-base font-semibold text-zinc-900">{week.label}</div>
                      <div className="mt-1 text-sm text-zinc-500">点击查看这周每门课程的状态详情。</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
                      <span className="rounded-full bg-emerald-100 px-3 py-2 font-medium text-emerald-700">已完成 {week.completedCount} 门</span>
                      <span className="rounded-full bg-amber-100 px-3 py-2 font-medium text-amber-700">待完成 {week.pendingCount} 门</span>
                      <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 font-medium text-zinc-600 ring-1 ring-zinc-200">
                        进入详情
                        <ChevronDown className="h-4 w-4 -rotate-90 text-zinc-400" />
                      </span>
                    </div>
                  </div>
                </MotionButton>
              ))}
            </div>
          ) : (
            <EmptyState title="还没有过往周" description="当前还是第一周，后续周次产生之后，这里会自动列出可回看的历史周。" />
          )}
        </div>
      </Modal>
      <Modal
        open={Boolean(selectedStatusHistoryWeek)}
        onClose={reopenStatusHistoryWeekList}
        title={selectedStatusHistoryWeek ? `${selectedStatusHistoryWeek.label} · 课程状态` : "历史周状态"}
        panelClassName="max-w-5xl"
      >
        {selectedStatusHistoryWeek ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm leading-6 text-zinc-500">这里保存了该周所有课程的状态。修改后和主页面共用同一套保存草稿，不会丢。</p>
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <MotionButton
                  onClick={reopenStatusHistoryWeekList}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  返回周列表
                </MotionButton>
                <StatusActionBar
                  hasUnsavedStatusChanges={hasUnsavedCourseStatusChanges}
                  changedCount={statusDraftSummary.fieldCount}
                  onDiscard={discardStatusChanges}
                  onSave={saveStatusChanges}
                />
              </div>
            </div>
            {statusHistoryRows.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-left text-sm text-zinc-500">
                      <th className="px-3">课程</th>
                      <th className="px-3">时间</th>
                      <th className="px-3">Vorlesung</th>
                      <th className="px-3">Hausaufgabe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusHistoryRows.map((course) => {
                      const lectureDone = Boolean(course.historyRecord?.lectureDone);
                      const homeworkDone = Boolean(course.historyRecord?.homeworkDone);
                      return (
                        <tr key={course.id} className="bg-zinc-50 text-sm shadow-sm">
                          <td className="rounded-l-3xl px-3 py-4 align-middle">
                            <div className="font-semibold text-zinc-900">{course.name}</div>
                            <div className="mt-1 text-xs text-zinc-500">{course.kind}</div>
                          </td>
                          <td className="px-3 py-4 align-middle text-zinc-600">
                            <div>{getEntityScheduleLabel(course) || "时间待定"}</div>
                          </td>
                          <td className="px-3 py-4 align-middle">
                            <StatusPill
                              done={lectureDone}
                              doneLabel="已上"
                              todoLabel="未上"
                              onClick={() => toggleWeeklyField(course.id, selectedStatusHistoryWeek.weekNumber, "lectureDone")}
                            />
                          </td>
                          <td className="rounded-r-3xl px-3 py-4 align-middle">
                            <StatusPill
                              done={homeworkDone}
                              doneLabel="已写"
                              todoLabel="未写"
                              onClick={() => toggleWeeklyField(course.id, selectedStatusHistoryWeek.weekNumber, "homeworkDone")}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="这周还没有课程状态" description="当前没有可展示的课程记录，请先确认课程数据是否已初始化。" />
            )}
          </div>
        ) : null}
      </Modal>
      <Modal open={Boolean(confirmState)} onClose={() => setConfirmState(null)} title={confirmState?.title || "确认操作"}>
        <div className="space-y-5">
          <p className="text-sm leading-6 text-zinc-600">{confirmState?.description}</p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <MotionButton onClick={() => setConfirmState(null)} className="rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              取消
            </MotionButton>
            <MotionButton onClick={handleConfirmAction} className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-500">
              {confirmState?.confirmLabel || "确认删除"}
            </MotionButton>
          </div>
        </div>
      </Modal>
      <Modal open={Boolean(unsavedPromptState)} onClose={() => setUnsavedPromptState(null)} title={unsavedPromptState?.title || "有未保存修改"}>
        <div className="space-y-5">
          <p className="text-sm leading-6 text-zinc-600">{unsavedPromptState?.description}</p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <MotionButton onClick={() => setUnsavedPromptState(null)} className="rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              取消
            </MotionButton>
            <MotionButton onClick={handleUnsavedPromptDiscard} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              不保存
            </MotionButton>
            <MotionButton onClick={handleUnsavedPromptSave} className="rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800">
              保存并继续
            </MotionButton>
          </div>
        </div>
      </Modal>
      <AnimatePresence>
        {toastMessage ? (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.18 }}
            className="fixed right-6 top-6 z-[60] rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-lg"
          >
            {toastMessage}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="fixed bottom-6 right-6 rounded-full bg-zinc-900 p-3 text-white shadow-lg hover:bg-zinc-800"
        title="回到顶部"
      >
        ↑
      </button>
    </div>
  );
}

