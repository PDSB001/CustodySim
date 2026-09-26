package com.custodysim.app.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalResources
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import com.custodysim.app.R
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.custodysim.app.AppContainer
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.data.task.ReportTask
import com.custodysim.app.data.task.TaskCategory
import com.custodysim.app.data.task.TaskCounts
import com.custodysim.app.data.task.TaskField
import com.custodysim.app.ui.common.ImageThumbs
import com.custodysim.app.ui.common.OverlaySheet
import com.custodysim.app.ui.common.rememberImagePicker
import com.custodysim.app.ui.common.statusColor
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.distinctUntilChanged
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.ScrollBehavior
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.DropdownItem
import top.yukonga.miuix.kmp.preference.OverlaySpinnerPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** 状态文案与 Web 端 `statusLabel` 一致（COMPLETED 属打卡侧状态，汇报任务不会出现）。 */
private val STATUS_LABEL = mapOf(
    "PENDING" to R.string.task_pending, "SUBMITTED" to R.string.task_submitted,
    "RETURNED" to R.string.task_returned,
    "EXPIRED" to R.string.task_expired,
    "APPROVED" to R.string.task_approved, "REJECTED" to R.string.task_rejected,
    "CANCELLED" to R.string.task_cancelled,
)

/** 分类按钮文案，与 Web 端「服刑任务」的三档筛选一致。 */
private val CATEGORY_LABELS = mapOf(
    TaskCategory.PENDING to R.string.task_category_pending,
    TaskCategory.REVIEW to R.string.task_category_review,
    TaskCategory.HISTORY to R.string.task_category_history,
)

/** 各分类空状态的标题与说明，文案与 Web 端一致。 */
private val CATEGORY_EMPTY_TITLE = mapOf(
    TaskCategory.PENDING to R.string.tasks_empty_pending,
    TaskCategory.REVIEW to R.string.tasks_empty_review,
    TaskCategory.HISTORY to R.string.tasks_empty_history,
)
private val CATEGORY_EMPTY_HINT = mapOf(
    TaskCategory.PENDING to R.string.tasks_empty_pending_hint,
    TaskCategory.REVIEW to R.string.tasks_empty_review_hint,
    TaskCategory.HISTORY to R.string.tasks_empty_history_hint,
)

/** formatter 只建一次：原来每次排版都要重新解析模式串，列表里开销被放大。 */
private val TASK_TIME_FORMATTER = DateTimeFormatter.ofPattern("MM-dd HH:mm")

/** ISO 时间转本地「MM-dd HH:mm」；解析失败时原样返回，不影响展示。 */
private fun formatDateTime(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(TASK_TIME_FORMATTER)
}.getOrDefault(iso)

/** 评分去掉无意义的 `.0` 尾缀。 */
private fun formatGrade(grade: Double): String =
    if (grade % 1.0 == 0.0) grade.toInt().toString() else grade.toString()

/** 任务列表每页条数：首屏只取一页，滚到底再取下一页。 */
private const val TASKS_PAGE_SIZE = 20

/** 服刑任务页：分类列表 + 动态表单提交。分类与 Web 端「服刑任务」一致。 */
@Composable
fun TasksScreen(container: AppContainer, scrollBehavior: ScrollBehavior) {
    val scope = rememberCoroutineScope()
    val snackbar = LocalAppSnackbar.current
    val listState = rememberAppListState()
    var category by remember { mutableStateOf(TaskCategory.PENDING) }
    var counts by remember { mutableStateOf<TaskCounts?>(null) }
    var tasks by remember { mutableStateOf<List<ReportTask>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var reachedEnd by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<ReportTask?>(null) }
    var sheetVisible by remember { mutableStateOf(false) }

    /** 刷新当前分类：回到第一页，顺带更新分类数字。 */
    suspend fun refresh() {
        val requested = category
        loading = true
        val result = container.taskRepository.fetchTasks(limit = TASKS_PAGE_SIZE, category = requested)
        // 期间已切到别的分类，这批数据作废（分类切换会重新拉取）。
        if (category != requested) return
        when (result) {
            is ApiResult.Ok -> {
                tasks = result.data
                reachedEnd = result.data.size < TASKS_PAGE_SIZE
                notice = null
            }
            is ApiResult.Err -> notice = result.message
        }
        loading = false
        // 分类数字取不到不影响列表展示。
        when (val countsResult = container.taskRepository.fetchTaskCounts()) {
            is ApiResult.Ok -> counts = countsResult.data
            is ApiResult.Err -> Unit
        }
    }

    /** 追加下一页；游标用最后一条的 (deadline, id)，与后端分类内的排序一致。 */
    suspend fun loadMore() {
        if (loading || loadingMore || reachedEnd) return
        val requested = category
        val originalTasks = tasks
        val last = tasks.lastOrNull() ?: return
        loadingMore = true
        try {
            val cursor = "${last.deadline}|${last.id}"
            val result = container.taskRepository.fetchTasks(
                limit = TASKS_PAGE_SIZE, cursor = cursor, category = requested,
            )
            if (category != requested || tasks !== originalTasks || loading) return
            when (result) {
                is ApiResult.Ok -> {
                    val known = tasks.mapTo(mutableSetOf()) { it.id }
                    val added = result.data.filter { known.add(it.id) }
                    tasks = tasks + added
                    reachedEnd = result.data.size < TASKS_PAGE_SIZE || added.isEmpty()
                    notice = null
                }
                is ApiResult.Err -> notice = result.message
            }
        } finally {
            loadingMore = false
        }
    }

    // 首次进入与切换分类都走这里：清空上一个分类的内容再拉第一页。
    LaunchedEffect(category) {
        tasks = emptyList()
        reachedEnd = false
        notice = null
        listState.scrollToItem(0)
        refresh()
    }

    // Observe visible items, not prefetched composition: cache windows must not
    // trigger a chain of network requests while the user remains at the top.
    LaunchedEffect(category, tasks.size, loading, reachedEnd, notice) {
        if (loading || reachedEnd || notice != null || tasks.isEmpty()) return@LaunchedEffect
        snapshotFlow {
            val layout = listState.layoutInfo
            layout.visibleItemsInfo.isNotEmpty() &&
                (layout.visibleItemsInfo.lastOrNull()?.index ?: -1) >= layout.totalItemsCount - 3
        }.distinctUntilChanged().collect { nearEnd -> if (nearEnd) loadMore() }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
        contentPadding = glassPagePadding(),
    ) {
        item {
            ListHeader(description = stringResource(R.string.tasks_hint),
                title = stringResource(R.string.task_list), loading = loading,
                onRefresh = { scope.launch { refresh() } })
        }
        item { CategoryTabs(selected = category, counts = counts, onSelect = { category = it }) }
        when {
            loading && tasks.isEmpty() -> item { PageState(stringResource(R.string.loading), loading = true) }
            notice != null && tasks.isEmpty() -> item {
                PageState(stringResource(R.string.load_failed), notice, onRetry = { scope.launch { refresh() } })
            }
            tasks.isEmpty() -> item {
                PageState(
                    stringResource(CATEGORY_EMPTY_TITLE.getValue(category)),
                    stringResource(CATEGORY_EMPTY_HINT.getValue(category)),
                )
            }
            else -> itemsIndexed(tasks, key = { _, task -> task.id }, contentType = { _, _ -> "task" }) { index, task ->
                    GroupedListItem(first = index == 0, last = index == tasks.lastIndex) {
                        TaskRow(task, onEdit = { editing = task; sheetVisible = true })
                        if (index < tasks.lastIndex) HorizontalDivider(
                            modifier = Modifier.padding(horizontal = AppSpace.inset),
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.12f))
                    }
            }
        }
        // Loading footer has no composition-triggered network side effects.
        if (tasks.isNotEmpty() && !reachedEnd && notice == null) {
            item(key = "tasks-load-more") {
                PageState(stringResource(R.string.loading), loading = true)
            }
        }
        if (tasks.isNotEmpty()) notice?.let { item { NoticeBanner(it, error = true) } }
    }

    editing?.let { task ->
        SubmitSheet(
            task = task,
            show = sheetVisible,
            container = container,
            onDismiss = { sheetVisible = false },
            onDismissFinished = { editing = null },
            onDone = {
                sheetVisible = false
                snackbar("任务填报已提交")
                scope.launch { refresh() }
            },
        )
    }
}

/**
 * 分类切换：严格单行 —— 三等分宽度 + 小字号（footnote1）+ 单行省略兜底。
 *
 * 不能用 Miuix 的 TextButton 按内容取宽：它字号大、内边距宽，「执行记录 · 15」会比三分之一
 * 宽度还宽，之前就是因此把文字画到了胶囊外面。这里自绘分段控件，选中态是主色实心，
 * 未选中态带描边（对应 Web 端筛选按钮的 default / outline 两种变体）；底部留出间距，
 * 免得和下面的任务卡片贴在一起。
 */
@Composable
private fun CategoryTabs(selected: TaskCategory, counts: TaskCounts?, onSelect: (TaskCategory) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = AppSpace.medium),
        horizontalArrangement = Arrangement.spacedBy(AppSpace.small),
    ) {
        TaskCategory.entries.forEach { item ->
            val active = item == selected
            val label = stringResource(CATEGORY_LABELS.getValue(item))
            val shape = RoundedCornerShape(AppShape.control)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(shape)
                    .background(if (active) MiuixTheme.colorScheme.primary else MiuixTheme.colorScheme.surface)
                    .then(
                        if (active) Modifier
                        else Modifier.border(1.dp, MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.35f), shape),
                    )
                    .clickable { onSelect(item) }
                    .padding(vertical = AppSpace.medium, horizontal = AppSpace.tiny),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = counts?.let { "$label · ${it.of(item)}" } ?: label,
                    style = MiuixTheme.textStyles.footnote1,
                    color = if (active) MiuixTheme.colorScheme.onPrimary else MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** 分组列表中的一个任务行；待提交 / 被退回的行整行可点。 */
@Composable
private fun TaskRow(task: ReportTask, onEdit: () -> Unit) {
    val actionable = task.status == "PENDING" || task.status == "RETURNED"
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (actionable) Modifier.clickable(onClick = onEdit) else Modifier)
            .padding(AppSpace.inset),
        verticalArrangement = Arrangement.spacedBy(AppSpace.small),
    ) {
        RecordContent(actionLabel = if (actionable) stringResource(R.string.task_fill) else null, onAction = onEdit) {
            StatusChip(STATUS_LABEL[task.status]?.let { stringResource(it) } ?: task.status, statusColor(task.status))
            Column {
                Text(task.title, style = MiuixTheme.textStyles.body1)
                task.templateContent?.let {
                    Text(it, style = MiuixTheme.textStyles.footnote1,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                }
                Text(
                    stringResource(R.string.deadline, formatDateTime(task.deadline)),
                    style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    modifier = Modifier.padding(top = 4.dp),
                )
                if (task.status == "RETURNED" && task.reviewComment != null) {
                    Text(
                        stringResource(R.string.review_returned, task.reviewComment),
                        style = MiuixTheme.textStyles.footnote1,
                        color = MiuixTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                if (task.submissionStatus != null && task.status != "PENDING" && task.status != "RETURNED") {
                    task.submissionData?.let { data ->
                        // 行内会随父级状态反复重组，摘要只在提交数据本身变化时重算。
                        val summary = remember(data) {
                            data.keys().asSequence().mapNotNull { key ->
                                data.optString(key).takeIf { it.isNotBlank() && it != "null" }?.let { "$key：$it" }
                            }.joinToString("\n")
                        }
                        if (summary.isNotBlank()) Text(summary, style = MiuixTheme.textStyles.footnote1,
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                    }
                    task.reviewComment?.let {
                        Text(stringResource(R.string.review_comment, it), style = MiuixTheme.textStyles.footnote1, modifier = Modifier.padding(top = 4.dp))
                    }
                    task.reviewGrade?.let {
                        Text(stringResource(R.string.review_grade, formatGrade(it)), style = MiuixTheme.textStyles.footnote1, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
    }
}

/** 动态表单提交弹层。 */
@Composable
private fun SubmitSheet(
    task: ReportTask,
    show: Boolean,
    container: AppContainer,
    onDismiss: () -> Unit,
    onDismissFinished: () -> Unit,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val draft = rememberFormDraft(container, "task:${task.id}")
    val resources = LocalResources.current
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    OverlaySheet(show = show, title = task.title, onDismiss = onDismiss, busy = busy,
        onDismissFinished = onDismissFinished) {
        LazyColumn(
            state = rememberAppListState(),
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(AppSpace.page),
        ) {
            item { NoticeBanner(stringResource(R.string.required_hint)) }
            item { draft.error?.let { NoticeBanner(it, error = true) } }
            items(task.fields, key = { it.name }, contentType = { it.type }) { field ->
                Column(verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                    FieldEditor(field, draft, enabled = !busy && draft.ready)
                    Spacer(Modifier.height(AppSpace.small))
                }
            }
            item { Column(verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                error?.let {
                    Text(it, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.error)
                    Spacer(Modifier.height(8.dp))
                }
                PrimaryAction(
                    text = stringResource(if (busy) R.string.submitting else R.string.submit),
                    busy = busy,
                    enabled = draft.ready,
                    onClick = {
                        val values = draft.values.filterKeys { name -> task.fields.any { it.name == name } }
                        val missing = task.fields.any { field ->
                            if (!field.required || field.type == "COPYWRITE") false
                            else when (val value = values[field.name]) {
                                null -> true
                                is String -> value.isBlank()
                                is List<*> -> value.isEmpty()
                                else -> false
                            }
                        }
                        if (missing) {
                            error = resources.getString(R.string.required_fields)
                            return@PrimaryAction
                        }
                        scope.launch {
                            busy = true
                            error = null
                            when (val result = container.taskRepository.submit(task.id, values.toMap())) {
                                is ApiResult.Ok -> { draft.submitted(); onDone() }
                                is ApiResult.Err -> error = result.message
                            }
                            busy = false
                        }
                    },
                )
                Spacer(Modifier.height(8.dp))
            } }
        }
    }
}

@Composable
private fun FieldEditor(field: TaskField, draft: FormDraft, enabled: Boolean) {
    val label = field.name + if (field.required) " *" else ""
    // 输入任一字段都会改写整个 values，直接读它会让同一表单里其它字段一起重组；
    // 这里把订阅收窄到本字段，只有本字段的值变了才重建这一行。
    val value by remember(field.name, draft) { derivedStateOf { draft.values[field.name] } }
    when (field.type) {
        "COPYWRITE" -> {
            Text(label, style = MiuixTheme.textStyles.body1)
            field.options.firstOrNull()?.let {
                Text(it, style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            }
            val text = (value as? String) ?: ""
            FramedTextField(value = text, onValueChange = { draft.set(field.name, it) },
                label = stringResource(R.string.copywrite_input), enabled = enabled,
                modifier = Modifier.fillMaxWidth())
        }

        "IMAGE" -> {
            Text(label, style = MiuixTheme.textStyles.body1)
            val images = (value as? List<*>)?.filterIsInstance<String>() ?: emptyList()
            if (images.isNotEmpty()) {
                ImageThumbs(images, Modifier.padding(top = AppSpace.small), onRemove = if (enabled) { index ->
                    draft.set(field.name, images.filterIndexed { i, _ -> i != index })
                } else null)
            }
            val picker = rememberImagePicker((3 - images.size).coerceAtLeast(1)) { urls -> draft.set(field.name, (images + urls).take(3)) }
            TextButton(
                text = if (images.isEmpty()) stringResource(R.string.add_images) else stringResource(R.string.more_images, images.size),
                enabled = enabled && images.size < 3,
                onClick = picker,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.textButtonColorsPrimary(),
            )
        }

        "SELECT" -> {
            val selected = value as? String
            val options = listOf("请选择") + field.options
            val selectedOption = selected?.let { field.options.indexOf(it) } ?: -1
            SettingGroup { OverlaySpinnerPreference(
                title = label,
                items = options.map { DropdownItem(text = it) },
                selectedIndex = selectedOption.takeIf { it >= 0 }?.plus(1) ?: 0,
                enabled = enabled,
                onSelectedIndexChange = { index -> draft.set(field.name, field.options.getOrNull(index - 1) ?: "") },
                modifier = Modifier.fillMaxWidth(),
            ) }
        }

        "TEXTAREA" -> {
            val text = (value as? String) ?: ""
            FramedTextField(value = text, onValueChange = { draft.set(field.name, it) },
                label = label, enabled = enabled, modifier = Modifier.fillMaxWidth())
        }

        "DATE" -> {
            val text = (value as? String) ?: ""
            DatePreference(label, text, enabled) { draft.set(field.name, it) }
        }

        else -> {
            val text = (value as? String) ?: ""
            FramedTextField(value = text,
                onValueChange = { draft.set(field.name, it) },
                label = label,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(keyboardType = if (field.type == "NUMBER") KeyboardType.Decimal else KeyboardType.Text),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
