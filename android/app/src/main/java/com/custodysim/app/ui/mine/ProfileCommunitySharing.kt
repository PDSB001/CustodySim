package com.custodysim.app.ui.mine

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import com.custodysim.app.data.community.communityProfileFieldTypes
import com.custodysim.app.data.portal.ProfileField
import com.custodysim.app.ui.common.SettingGroup
import com.custodysim.app.ui.theme.AppSpace
import com.custodysim.app.ui.theme.LocalEffects
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.preference.CheckboxPreference
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** Group selectors are presentation only; the API still receives explicitly chosen field names. */
@Composable
internal fun ProfileCommunitySharing(
    formId: String, fields: List<ProfileField>, values: Map<String, String>, sharing: Boolean,
    selected: Set<String>, enabled: Boolean, modifier: Modifier = Modifier,
    onSharingChange: (Boolean) -> Unit, onSelectionChange: (Set<String>) -> Unit,
) {
    val reduceMotion = LocalEffects.current.reduceMotion
    val duration = if (reduceMotion) 0 else 200
    var retainedSelection by remember { mutableStateOf(selected) }
    SideEffect { if (sharing) retainedSelection = selected }
    val visibleSelection = if (sharing) selected else retainedSelection
    val canEdit = enabled && sharing
    val groups = remember(fields) {
        fields.filter { it.type in communityProfileFieldTypes }.groupBy { field ->
            when (val section = profileSection(field.name)) {
                "体貌特征", "体态与尺寸" -> "体态特征"
                else -> section
            }
        }
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
        SettingGroup {
            SwitchPreference(
                title = "分享至匿名社区", summary = "默认关闭，分享范围由你选择",
                checked = sharing, enabled = enabled, onCheckedChange = onSharingChange,
                bottomAction = {
                    Text("仅公开勾选的内容。身份字段勾选后也会公开；照片、签名与公章不分享。",
                        style = MiuixTheme.textStyles.footnote2,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                        modifier = Modifier.fillMaxWidth().padding(top = AppSpace.medium))
                },
            )
        }
        AnimatedVisibility(sharing,
            enter = fadeIn(tween(duration)) + expandVertically(tween(duration), clip = false),
            exit = fadeOut(tween(duration)) + shrinkVertically(tween(duration), clip = false)) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                groups.forEach { (title, groupFields) -> key(formId, title) {
                    var expanded by rememberSaveable(formId, title) { mutableStateOf(false) }
                    val available = groupFields.filter { !values[it.name].isNullOrBlank() }.map { it.name }.toSet()
                    val chosen = available.count { it in visibleSelection }
                    SettingGroup {
                        ArrowPreference(
                            title = title,
                            summary = if (available.isEmpty()) "尚未填写" else "已选 $chosen 项 · ${available.size} 项已填写",
                            enabled = canEdit,
                            modifier = Modifier.semantics {
                                stateDescription = if (expanded) "已展开" else "已收起"
                            },
                            onClick = { expanded = !expanded },
                        )
                        AnimatedVisibility(expanded,
                            enter = fadeIn(tween(duration)) + expandVertically(tween(duration), clip = false),
                            exit = fadeOut(tween(duration)) + shrinkVertically(tween(duration), clip = false)) {
                            Column(Modifier.fillMaxWidth()) {
                                CheckboxPreference(
                                    title = "选择本类全部已填写内容",
                                    summary = "仅包含当前已填写的 ${available.size} 项",
                                    checked = available.isNotEmpty() && chosen == available.size,
                                    enabled = canEdit && available.isNotEmpty(),
                                    onCheckedChange = { checked ->
                                        onSelectionChange(if (checked) selected + available else selected - groupFields.map { it.name }.toSet())
                                    },
                                )
                                groupFields.forEach { field -> key(field.name) {
                                    CheckboxPreference(
                                        title = field.name,
                                        summary = values[field.name].orEmpty().replace('\n', ' ').take(60).ifBlank { "尚未填写" },
                                        checked = field.name in visibleSelection,
                                        enabled = canEdit && field.name in available,
                                        onCheckedChange = { checked ->
                                            onSelectionChange(if (checked) selected + field.name else selected - field.name)
                                        },
                                    )
                                } }
                            }
                        }
                    }
                } }
            }
        }
        AnimatedVisibility(sharing,
            enter = fadeIn(tween(duration)) + expandVertically(tween(duration), clip = false),
            exit = fadeOut(tween(duration)) + shrinkVertically(tween(duration), clip = false)) {
            SettingGroup {
                Column(Modifier.fillMaxWidth().padding(AppSpace.inset), verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                    Text("社区公开预览 · 楼主", style = MiuixTheme.textStyles.body1)
                    val chosenGroups = groups.mapValues { (_, groupFields) ->
                        groupFields.filter { it.name in visibleSelection && !values[it.name].isNullOrBlank() }
                    }.filterValues { it.isNotEmpty() }
                    if (chosenGroups.isEmpty()) Text("选择已填写的内容后，这里会显示公开预览。",
                        style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                    chosenGroups.forEach { (title, groupFields) ->
                        Text(title, style = MiuixTheme.textStyles.footnote1.copy(fontWeight = FontWeight.Medium))
                        Text(groupFields.joinToString(" · ") { "${it.name}：${values[it.name].orEmpty()}" },
                            modifier = Modifier.fillMaxWidth(), style = MiuixTheme.textStyles.footnote1,
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                    }
                    Text("提交会签时发布，可在社区删除自己的分享帖。", style = MiuixTheme.textStyles.footnote2,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                }
            }
        }
    }
}
