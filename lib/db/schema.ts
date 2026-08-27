import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  type AnyPgColumn,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core"

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => organizations.id),
  category: varchar("category", { length: 50 }),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  role: varchar("role", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  tokenVersion: integer("token_version").notNull().default(0),
  passwordMeta: text("password_meta"),
  organizationId: uuid("organization_id").references(() => organizations.id),
  phone: varchar("phone", { length: 20 }),
  avatar: text("avatar"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const persons = pgTable(
  "persons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    gender: varchar("gender", { length: 20 }),
    age: integer("age"),
    personType: varchar("person_type", { length: 30 })
      .notNull()
      .default("SUPERVISED"),
    prisonerNumber: varchar("prisoner_number", { length: 50 }),
    customNumber: varchar("custom_number", { length: 50 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    treatmentLevel: varchar("treatment_level", { length: 50 }),
    nativePlace: varchar("native_place", { length: 100 }),
    level: varchar("level", { length: 50 }),
    evaluation: varchar("evaluation", { length: 100 }),
    chargeName: varchar("charge_name", { length: 300 }),
    sentenceStartDate: date("sentence_start_date"),
    sentenceEndDate: date("sentence_end_date"),
    custodyLevel: varchar("custody_level", { length: 20 })
      .notNull()
      .default("GENERAL"),
    custodyStatus: varchar("custody_status", { length: 20 })
      .notNull()
      .default("OUT_OF_CUSTODY"),
    remark: text("remark"),
    organizationId: uuid("organization_id").references(() => organizations.id),
    userId: uuid("user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("persons_organization_idx").on(table.organizationId),
    index("persons_custody_profile_idx").on(
      table.custodyStatus,
      table.custodyLevel,
    ),
    uniqueIndex("persons_user_unique").on(table.userId),
    uniqueIndex("persons_prisoner_number_unique").on(table.prisonerNumber),
  ],
)

export const electronicFences = pgTable(
  "electronic_fences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryType: varchar("entry_type", { length: 20 })
      .notNull()
      .default("CONFIG"),
    name: varchar("name", { length: 100 }).notNull(),
    latitude: varchar("latitude", { length: 32 }).notNull(),
    longitude: varchar("longitude", { length: 32 }).notNull(),
    radiusMeters: integer("radius_meters").notNull(),
    boundaryPoints: jsonb("boundary_points").$type<Array<{ latitude: number; longitude: number }>>().notNull().default([]),
    coordinateSystem: varchar("coordinate_system", { length: 20 })
      .notNull()
      .default("GCJ02"),
    enabled: boolean("enabled").notNull().default(true),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    fenceId: uuid("fence_id").references(
      (): AnyPgColumn => electronicFences.id,
      { onDelete: "cascade" },
    ),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    accuracyMeters: integer("accuracy_meters"),
    verdict: varchar("verdict", { length: 30 }),
    transition: varchar("transition", { length: 30 }),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("electronic_fences_enabled_idx").on(table.enabled),
    index("electronic_fences_type_updated_idx").on(
      table.entryType,
      table.updatedAt,
    ),
    index("electronic_fences_user_reported_idx").on(
      table.userId,
      table.reportedAt,
    ),
  ],
)

export const uiConfigs = pgTable(
  "ui_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: varchar("scope", { length: 20 }).notNull(),
    homeTitle: varchar("home_title", { length: 200 }).notNull().default(""),
    homeSubtitle: varchar("home_subtitle", { length: 500 })
      .notNull()
      .default(""),
    homeBanner: text("home_banner").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("ui_configs_scope_unique").on(table.scope)],
)

export const numberingRules = pgTable(
  "numbering_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    docType: varchar("doc_type", { length: 50 }).notNull(),
    prefix: varchar("prefix", { length: 30 }).notNull().default("CS"),
    dateFormat: varchar("date_format", { length: 20 })
      .notNull()
      .default("yyyyMM"),
    generationMode: varchar("generation_mode", { length: 20 })
      .notNull()
      .default("RANDOM"),
    minLength: integer("min_length").notNull().default(4),
    randomLength: integer("random_length").notNull().default(6),
    currentSeq: integer("current_seq").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("numbering_rules_doc_type_unique").on(table.docType)],
)

export const prisonerNumberChanges = pgTable(
  "prisoner_number_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    oldNumber: varchar("old_number", { length: 50 }),
    newNumber: varchar("new_number", { length: 50 }).notNull(),
    reason: text("reason"),
    requestedBy: uuid("requested_by").references(() => users.id),
    status: varchar("status", { length: 20 }).notNull().default("approved"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("prisoner_number_changes_person_idx").on(table.personId)],
)

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").references(() => users.id),
    actorName: varchar("actor_name", { length: 100 }).notNull(),
    actorRole: varchar("actor_role", { length: 20 }).notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    actionLabel: varchar("action_label", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
)

export const loginLogs = pgTable(
  "login_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    username: varchar("username", { length: 50 }).notNull(),
    ip: varchar("ip", { length: 64 }),
    location: varchar("location", { length: 100 }),
    userAgent: text("user_agent"),
    success: boolean("success").notNull(),
    failReason: varchar("fail_reason", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("login_logs_user_idx").on(table.userId),
    index("login_logs_created_at_idx").on(table.createdAt),
  ],
)

export const loginRateLimits = pgTable(
  "login_rate_limits",
  {
    key: varchar("key", { length: 64 }).primaryKey(),
    attemptCount: integer("attempt_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("login_rate_limits_blocked_idx").on(table.blockedUntil)],
)

export const supervisionRelations = pgTable(
  "supervision_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("supervision_relations_status_idx").on(table.status)],
)

export const supervisionRelationScopes = pgTable(
  "supervision_relation_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    relationId: uuid("relation_id")
      .notNull()
      .references(() => supervisionRelations.id, { onDelete: "cascade" }),
    side: varchar("side", { length: 20 }).notNull(),
    targetType: varchar("target_type", { length: 20 }).notNull(),
    targetId: uuid("target_id").notNull(),
  },
  (table) => [
    index("supervision_relation_scopes_relation_idx").on(table.relationId),
    index("supervision_relation_scopes_target_idx").on(
      table.side,
      table.targetType,
      table.targetId,
    ),
  ],
)

export const ruleGroups = pgTable("rule_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  remark: text("remark"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const ruleGroupScopes = pgTable(
  "rule_group_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => ruleGroups.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 20 }).notNull(),
    targetId: uuid("target_id").notNull(),
  },
  (table) => [index("rule_group_scopes_group_idx").on(table.groupId)],
)

export const rules = pgTable(
  "rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    type: varchar("type", { length: 30 }).notNull().default("REPORT"),
    taskType: varchar("task_type", { length: 30 }).notNull().default("REPORT"),
    freq: varchar("freq", { length: 30 }).notNull().default("DAILY"),
    scheduleDays: jsonb("schedule_days").notNull().default([]),
    timeSlots: jsonb("time_slots").notNull().default([]),
    timezone: varchar("timezone", { length: 50 })
      .notNull()
      .default("Asia/Shanghai"),
    needPhoto: boolean("need_photo").notNull().default(false),
    needLocation: boolean("need_location").notNull().default(false),
    allowNoLocation: boolean("allow_no_location").notNull().default(false),
    needRemark: boolean("need_remark").notNull().default(false),
    timeoutMinutes: integer("timeout_minutes").notNull().default(30),
    custodyLevel: varchar("custody_level", { length: 20 }),
    slotSettings: jsonb("slot_settings").notNull().default([]),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    ruleGroupId: uuid("rule_group_id").references(() => ruleGroups.id, {
      onDelete: "set null",
    }),
    templateId: uuid("template_id"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rules_group_idx").on(table.ruleGroupId),
    index("rules_enabled_idx").on(table.enabled),
  ],
)

export const ruleScopes = pgTable(
  "rule_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 20 }).notNull(),
    targetId: uuid("target_id").notNull(),
  },
  (table) => [index("rule_scopes_rule_idx").on(table.ruleId)],
)

export const reportTemplates = pgTable("report_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  kind: varchar("kind", { length: 30 }).notNull().default("REPORT"),
  content: text("content"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const reportTemplateFields = pgTable(
  "report_template_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => reportTemplates.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    type: varchar("type", { length: 30 }).notNull().default("TEXT"),
    required: boolean("required").notNull().default(false),
    options: jsonb("options").notNull().default([]),
    sort: integer("sort").notNull().default(0),
  },
  (table) => [
    index("report_template_fields_template_idx").on(table.templateId),
  ],
)

export const templateScopes = pgTable(
  "template_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => reportTemplates.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 20 }).notNull(),
    targetId: uuid("target_id").notNull(),
  },
  (table) => [index("template_scopes_template_idx").on(table.templateId)],
)

export const reportTasks = pgTable(
  "report_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 160 }).notNull(),
    supervisorId: uuid("supervisor_id").references(() => users.id),
    supervisedId: uuid("supervised_id")
      .notNull()
      .references(() => users.id),
    ruleId: uuid("rule_id").references(() => rules.id, {
      onDelete: "set null",
    }),
    templateId: uuid("template_id").references(() => reportTemplates.id, {
      onDelete: "set null",
    }),
    templateSnapshot: jsonb("template_snapshot").notNull().default({}),
    payload: jsonb("payload").notNull().default({}),
    source: varchar("source", { length: 30 }).notNull().default("RULE"),
    scheduleAt: timestamp("schedule_at", { withTimezone: true }).notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("report_tasks_supervised_schedule_idx").on(
      table.supervisedId,
      table.scheduleAt,
    ),
    index("report_tasks_status_idx").on(table.status),
    uniqueIndex("report_tasks_rule_user_schedule_unique").on(
      table.ruleId,
      table.supervisedId,
      table.scheduleAt,
    ),
  ],
)

export const reportSubmissions = pgTable(
  "report_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => reportTasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    data: jsonb("data").notNull().default({}),
    status: varchar("status", { length: 30 }).notNull().default("SUBMITTED"),
    officialSealData: text("official_seal_data"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("report_submissions_task_unique").on(table.taskId)],
)

export const reportReviews = pgTable(
  "report_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => reportSubmissions.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id),
    result: varchar("result", { length: 20 }).notNull(),
    grade: integer("grade"),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("report_reviews_submission_idx").on(table.submissionId)],
)

export const checkinTasks = pgTable(
  "checkin_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    supervisedId: uuid("supervised_id")
      .notNull()
      .references(() => users.id),
    supervisorId: uuid("supervisor_id").references(() => users.id),
    slotIndex: integer("slot_index").notNull(),
    scheduleAt: timestamp("schedule_at", { withTimezone: true }).notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("checkin_tasks_supervised_schedule_idx").on(
      table.supervisedId,
      table.scheduleAt,
    ),
    index("checkin_tasks_status_idx").on(table.status),
    uniqueIndex("checkin_tasks_rule_user_schedule_unique").on(
      table.ruleId,
      table.supervisedId,
      table.scheduleAt,
    ),
  ],
)

export const checkinRecords = pgTable(
  "checkin_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => checkinTasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    checkinAt: timestamp("checkin_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 30 }).notNull(),
    slotIndex: integer("slot_index").notNull(),
    photoUrl: text("photo_url"),
    location: jsonb("location").notNull().default({}),
    locationSource: varchar("location_source", { length: 20 })
      .notNull()
      .default("IP"),
    lat: varchar("lat", { length: 40 }),
    lng: varchar("lng", { length: 40 }),
    gpsExpiresAt: timestamp("gps_expires_at", { withTimezone: true }),
    ip: varchar("ip", { length: 64 }),
    clientType: varchar("client_type", { length: 50 }),
    browserType: varchar("browser_type", { length: 100 }),
    remark: text("remark"),
    makeupId: uuid("makeup_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("checkin_records_task_unique").on(table.taskId),
    index("checkin_records_user_created_idx").on(table.userId, table.createdAt),
    index("checkin_records_gps_expiry_idx").on(table.gpsExpiresAt),
  ],
)

export const checkinMakeups = pgTable(
  "checkin_makeups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => checkinTasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    supervisorId: uuid("supervisor_id").references(() => users.id),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => rules.id),
    date: timestamp("date", { withTimezone: true }).notNull(),
    slotIndex: integer("slot_index").notNull(),
    reason: text("reason").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("PENDING"),
    photoUrl: text("photo_url"),
    location: jsonb("location").notNull().default({}),
    ip: varchar("ip", { length: 64 }),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    reviewComment: text("review_comment"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("checkin_makeups_task_unique").on(table.taskId),
    index("checkin_makeups_user_status_idx").on(table.userId, table.status),
    index("checkin_makeups_supervisor_status_idx").on(
      table.supervisorId,
      table.status,
    ),
  ],
)

export const profileForms = pgTable(
  "profile_forms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 30 })
      .notNull()
      .default("SUPERVISED"),
    content: text("content"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("profile_forms_active_idx").on(table.active)],
)

export const profileFields = pgTable(
  "profile_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => profileForms.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    type: varchar("type", { length: 30 }).notNull().default("TEXT"),
    required: boolean("required").notNull().default(false),
    options: jsonb("options").notNull().default([]),
    sort: integer("sort").notNull().default(0),
  },
  (table) => [index("profile_fields_form_idx").on(table.formId)],
)

export const archiveBoxes = pgTable(
  "archive_boxes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    remark: text("remark"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("archive_boxes_person_idx").on(table.personId),
    uniqueIndex("archive_boxes_person_name_unique").on(
      table.personId,
      table.name,
    ),
  ],
)

export const profileRecords = pgTable(
  "profile_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    formId: uuid("form_id")
      .notNull()
      .references(() => profileForms.id),
    formSnapshot: jsonb("form_snapshot").notNull().default({}),
    data: jsonb("data").notNull().default({}),
    photoData: text("photo_data"),
    signatureMode: varchar("signature_mode", { length: 20 })
      .notNull()
      .default("GENERATED"),
    generatedSignatureData: text("generated_signature_data"),
    handwrittenSignatureEncrypted: text("handwritten_signature_encrypted"),
    officialSealData: text("official_seal_data"),
    status: varchar("status", { length: 30 }).notNull().default("DRAFT"),
    code: varchar("code", { length: 80 }),
    boxId: uuid("box_id").references(() => archiveBoxes.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("profile_records_user_form_unique").on(
      table.userId,
      table.formId,
    ),
    uniqueIndex("profile_records_code_unique").on(table.code),
    index("profile_records_user_status_idx").on(table.userId, table.status),
    index("profile_records_box_idx").on(table.boxId),
  ],
)

export const profileRecordReviews = pgTable(
  "profile_record_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => profileRecords.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id),
    step: integer("step").notNull().default(0),
    result: varchar("result", { length: 20 }).notNull().default("WAITING"),
    grade: integer("grade"),
    comment: text("comment"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("profile_record_reviews_record_reviewer_unique").on(
      table.recordId,
      table.reviewerId,
    ),
    index("profile_record_reviews_reviewer_result_idx").on(
      table.reviewerId,
      table.result,
    ),
  ],
)

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: varchar("type", { length: 40 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    reason: text("reason").notNull(),
    payload: jsonb("payload").notNull().default({}),
    archiveRecordId: uuid("archive_record_id").references(
      () => profileRecords.id,
      {
        onDelete: "set null",
      },
    ),
    archiveSnapshot: jsonb("archive_snapshot"),
    officialSealData: text("official_seal_data"),
    status: varchar("status", { length: 30 }).notNull().default("DRAFT"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("applications_user_status_idx").on(table.userId, table.status),
    index("applications_archive_idx").on(table.archiveRecordId),
  ],
)

export const officialSeals = pgTable(
  "official_seals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: varchar("kind", { length: 30 }).notNull(),
    organizationName: varchar("organization_name", { length: 100 })
      .notNull()
      .default("第一监狱"),
    sealText: varchar("seal_text", { length: 100 }).notNull(),
    active: boolean("active").notNull().default(true),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("official_seals_kind_unique").on(table.kind)],
)

export const notices = pgTable(
  "notices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 200 }).notNull(),
    content: text("content").notNull(),
    targetRole: varchar("target_role", { length: 20 }).notNull().default("ALL"),
    priority: varchar("priority", { length: 20 }).notNull().default("NORMAL"),
    published: boolean("published").notNull().default(true),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notices_published_idx").on(table.published, table.publishedAt),
  ],
)

export const noticeReads = pgTable(
  "notice_reads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notice_reads_notice_user_unique").on(
      table.noticeId,
      table.userId,
    ),
    index("notice_reads_user_idx").on(table.userId, table.readAt),
  ],
)

export const applicationReviews = pgTable(
  "application_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id),
    step: integer("step").notNull().default(0),
    result: varchar("result", { length: 20 }).notNull().default("WAITING"),
    comment: text("comment"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("application_reviews_application_reviewer_unique").on(
      table.applicationId,
      table.reviewerId,
    ),
    index("application_reviews_reviewer_result_idx").on(
      table.reviewerId,
      table.result,
    ),
  ],
)
