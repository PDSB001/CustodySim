package com.custodysim.app.ui.tasks

import androidx.compose.foundation.clickable
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import com.custodysim.app.R
import com.custodysim.app.ui.common.*
import com.custodysim.app.ui.theme.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.unit.dp
import com.custodysim.app.AppContainer
import com.custodysim.app.data.net.ApiResult
import com.custodysim.app.data.task.ReportTask
import com.custodysim.app.data.task.TaskField
import com.custodysim.app.ui.common.ImageThumbs
import com.custodysim.app.ui.common.OverlaySheet
import com.custodysim.app.ui.common.rememberImagePicker
import com.custodysim.app.ui.common.statusColor
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.RadioButton
import top.yukonga.miuix.kmp.basic.ScrollBehavior
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.basic.DropdownItem
import top.yukonga.miuix.kmp.preference.OverlaySpinnerPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme
import androidx.compose.ui.platform.LocalContext
import android.app.DatePickerDialog
import java.util.Calendar
import java.util.Locale
import java.time.OffsetDateTime
import java.time.ZoneId

private val STATUS_LABEL = mapOf(
    "PENDING" to R.string.task_pending, "SUBMITTED" to R.string.task_submitted,
    "RETURNED" to R.string.task_returned, "COMPLETED" to R.string.task_completed,
    "EXPIRED" to R.string.task_expired,
    "APPROVED" to R.string.task_approved, "REJECTED" to R.string.task_rejected,
    "CANCELLED" to R.string.task_cancelled,
)

/** ISO 时间转本地「MM-dd HH:mm」；解析失败时原样返回，不影响展示。 */
private fun formatDateTime(iso: String): String = runCatching {
    val t = OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault())
    String.format(java.util.Locale.getDefault(), "%02d-%02d %02d:%02d", t.monthValue, t.dayOfMonth, t.hour, t.minute)
}.getOrDefault(iso)

/** 评分去掉无意义的 `.0` 尾缀。 */
private fun formatGrade(grade: Double): String =
    if (grade % 1.0 == 0.0) grade.toInt().toString() else grade.toString()

/** 服刑任务页：列表 + 动态表单提交。 */
@Composable
fun TasksScreen(container: AppContainer, scrollBehavior: ScrollBehavior) {
    val scope = rememberCoroutineScope()
    var tasks by remember { mutableStateOf<List<ReportTask>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var notice by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<ReportTask?>(null) }
    var sheetVisible by remember { mutableStateOf(false) }

    suspend fun refresh() {
        loading = true
        when (val result = container.taskRepository.fetchTasks()) {
            is ApiResult.Ok -> { tasks = result.data; notice = null }
            is ApiResult.Err -> notice = result.message
        }
        loading = false
    }

    LaunchedEffect(Unit) { refresh() }

    LazyColumn(
        modifier = Modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection),
        contentPadding = PaddingValues(AppSpace.page),
    ) {
        item {
            ListHeader(description = stringResource(R.string.tasks_hint),
                title = stringResource(R.string.task_list), loading = loading,
                onRefresh = { scope.launch { refresh() } })
        }
        when {
            loading && tasks.isEmpty() -> item { PageState(stringResource(R.string.loading), loading = true) }
            notice != null && tasks.isEmpty() -> item {
                PageState(stringResource(R.string.load_failed), notice, onRetry = { scope.launch { refresh() } })
            }
            tasks.isEmpty() -> item {
                PageState(stringResource(R.string.tasks_empty), stringResource(R.string.tasks_empty_hint))
            }
            else -> itemsIndexed(tasks, key = { _, task -> task.id }) { index, task ->
                AnimatedVisibility(visible = true,
                    enter = fadeIn(tween(260, delayMillis = index * 35)) +
                        slideInVertically(tween(260, delayMillis = index * 35)) { it / 10 }) {
                    GroupedListItem(first = index == 0, last = index == tasks.lastIndex) {
                        TaskRow(task, onEdit = { editing = task; sheetVisible = true })
                    }
                }
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
                scope.launch { refresh() }
            },
        )
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
                        val summary = data.keys().asSequence().mapNotNull { key ->
                            data.optString(key).takeIf { it.isNotBlank() && it != "null" }?.let { "$key：$it" }
                        }.joinToString("\n")
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
    val values = remember(task.id) { mutableStateMapOf<String, Any?>() }
    val resources = LocalResources.current
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    OverlaySheet(show = show, title = task.title, onDismiss = onDismiss, busy = busy,
        onDismissFinished = onDismissFinished) {
        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(AppSpace.page),
        ) {
            item { NoticeBanner(stringResource(R.string.required_hint)) }
            items(task.fields, key = { it.name }) { field ->
                FieldEditor(field, values, enabled = !busy)
                Spacer(Modifier.height(AppSpace.page))
            }
            item {
                error?.let {
                    Text(it, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.error)
                    Spacer(Modifier.height(8.dp))
                }
                PrimaryAction(
                    text = stringResource(if (busy) R.string.submitting else R.string.submit),
                    busy = busy,
                    onClick = {
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
                                is ApiResult.Ok -> onDone()
                                is ApiResult.Err -> error = result.message
                            }
                            busy = false
                        }
                    },
                )
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun FieldEditor(field: TaskField, values: MutableMap<String, Any?>, enabled: Boolean) {
    val label = field.name + if (field.required) " *" else ""
    when (field.type) {
        "COPYWRITE" -> {
            Text(label, style = MiuixTheme.textStyles.body1)
            field.options.firstOrNull()?.let {
                Text(it, style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
            }
            val text = (values[field.name] as? String) ?: ""
            TextField(value = text, onValueChange = { values[field.name] = it },
                label = stringResource(R.string.copywrite_input), enabled = enabled,
                modifier = Modifier.fillMaxWidth())
        }

        "IMAGE" -> {
            Text(label, style = MiuixTheme.textStyles.body1)
            val current = (values[field.name] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
            if (current.isNotEmpty()) {
                ImageThumbs(current, Modifier.padding(top = AppSpace.small), onRemove = if (enabled) { index ->
                    values[field.name] = current.filterIndexed { i, _ -> i != index }
                } else null)
            }
            val picker = rememberImagePicker((3 - current.size).coerceAtLeast(1)) { urls -> values[field.name] = (current + urls).take(3) }
            TextButton(
                text = if (current.isEmpty()) stringResource(R.string.add_images) else stringResource(R.string.more_images, current.size),
                enabled = enabled && current.size < 3,
                onClick = picker,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.textButtonColorsPrimary(),
            )
        }

        "SELECT" -> {
            val current = values[field.name] as? String
            val options = listOf("请选择") + field.options
            val selectedOption = current?.let { field.options.indexOf(it) } ?: -1
            OverlaySpinnerPreference(
                title = label,
                items = options.map { DropdownItem(text = it) },
                selectedIndex = selectedOption.takeIf { it >= 0 }?.plus(1) ?: 0,
                enabled = enabled,
                onSelectedIndexChange = { index -> values[field.name] = field.options.getOrNull(index - 1) ?: "" },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        "TEXTAREA" -> {
            val text = (values[field.name] as? String) ?: ""
            TextField(value = text, onValueChange = { values[field.name] = it },
                label = label, enabled = enabled, modifier = Modifier.fillMaxWidth())
        }

        "DATE" -> {
            val text = (values[field.name] as? String) ?: ""
            DatePickerField(label, text, enabled) { values[field.name] = it }
        }

        else -> {
            val text = (values[field.name] as? String) ?: ""
            TextField(
                value = text,
                onValueChange = { values[field.name] = it },
                label = label,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(keyboardType = if (field.type == "NUMBER") KeyboardType.Decimal else KeyboardType.Text),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun DatePickerField(label: String, value: String, enabled: Boolean, onValueChange: (String) -> Unit) {
    val context = LocalContext.current
    TextButton(
        text = if (value.isBlank()) "$label（选择日期）" else "$label：$value",
        enabled = enabled,
        onClick = {
            val now = Calendar.getInstance()
            DatePickerDialog(context, { _, year, month, day ->
                onValueChange(String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, day))
            }, now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH)).show()
        },
        modifier = Modifier.fillMaxWidth(),
        colors = ButtonDefaults.textButtonColorsPrimary(),
    )
}
