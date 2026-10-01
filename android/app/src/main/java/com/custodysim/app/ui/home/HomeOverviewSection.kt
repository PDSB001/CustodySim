package com.custodysim.app.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.sin
import com.custodysim.app.data.portal.HomeOverview
import com.custodysim.app.ui.MainTab
import com.custodysim.app.ui.common.NoticeBanner
import com.custodysim.app.ui.common.SectionTitle
import com.custodysim.app.ui.theme.AppColors
import com.custodysim.app.ui.theme.AppShape
import com.custodysim.app.ui.theme.AppSpace
import com.custodysim.app.ui.theme.LocalEffects
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Notes
import top.yukonga.miuix.kmp.icon.extended.Promotions
import top.yukonga.miuix.kmp.icon.extended.Recent
import top.yukonga.miuix.kmp.icon.extended.Tasks
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** 首次尚未读到数据时的占位，避免把网络错误显示成 0。 */
private const val UNKNOWN_VALUE = "—"
private const val UNREAD_HINT = "尚未读取"

/** 每张概览卡并排显示几项：一屏看 2 项，比"一页一项"更密。 */
private const val BLOCKS_PER_PAGE = 2

/** 定位概览页的文案由 HomeScreen 解析后传入，概览自身不关心权限实现。 */
internal data class LocationOverview(val status: String, val hint: String)

/**
 * 卡片里的一个"tab"块。[onClick] 为空表示只读（定位概览），整块不可点。
 * [icon] 为空时标签行只留文字。
 */
private data class OverviewBlock(
    val label: String,
    val value: String,
    val detail: String,
    val icon: ImageVector?,
    val tone: Color,
    val onClick: (() -> Unit)?,
)

/** 语义色在 composable 里解析成普通值再传入，映射函数保持纯函数。 */
private data class OverviewPalette(
    val primary: Color,
    val error: Color,
    val success: Color,
    val warning: Color,
    val muted: Color,
)

/**
 * 概览数据 → 卡片模型。纯函数：不读 CompositionLocal，颜色由 [palette] 注入。
 * 计数为 0 时退回成功色，逾期/退回才用警示色，避免"没事也报警"。
 */
private fun overviewBlocks(
    overview: HomeOverview?,
    supervised: Boolean,
    palette: OverviewPalette,
    onNavigate: (MainTab) -> Unit,
    onNotices: () -> Unit,
): List<OverviewBlock> = buildList {
    if (supervised) {
        val checkins = overview?.checkins
        add(OverviewBlock(
            label = "今日点名",
            value = checkins?.let { "${it.completed}/${it.total}" } ?: UNKNOWN_VALUE,
            detail = when {
                checkins == null -> UNREAD_HINT
                checkins.total == 0 -> "今日暂无点名安排"
                checkins.missed > 0 -> "待完成 ${checkins.pending} · 逾期未完成 ${checkins.missed}"
                else -> "待完成 ${checkins.pending}"
            },
            icon = MiuixIcons.Recent,
            tone = when {
                checkins == null -> palette.muted
                checkins.missed > 0 -> palette.error
                checkins.pending > 0 -> palette.primary
                else -> palette.success
            },
            onClick = { onNavigate(MainTab.CHECKINS) },
        ))
        val tasks = overview?.tasks
        add(OverviewBlock(
            label = "待完成任务",
            value = tasks?.let { "${it.pending}" } ?: UNKNOWN_VALUE,
            detail = tasks?.let { "${it.pending} 项待执行 · ${it.review} 项待批阅" } ?: UNREAD_HINT,
            icon = MiuixIcons.Notes,
            tone = when {
                tasks == null -> palette.muted
                tasks.pending > 0 -> palette.warning
                else -> palette.success
            },
            onClick = { onNavigate(MainTab.TASKS) },
        ))
        val applications = overview?.applications
        add(OverviewBlock(
            label = "申请进度",
            value = applications?.let { "${it.review + it.returned}" } ?: UNKNOWN_VALUE,
            detail = applications?.let { "${it.review} 项会签中 · ${it.returned} 项已退回" } ?: UNREAD_HINT,
            icon = MiuixIcons.Tasks,
            tone = when {
                applications == null -> palette.muted
                applications.returned > 0 -> palette.error
                applications.review > 0 -> palette.primary
                else -> palette.success
            },
            onClick = { onNavigate(MainTab.APPLICATIONS) },
        ))
    }
    val unread = overview?.unreadNotices
    add(OverviewBlock(
        label = "公告通知",
        value = unread?.let { "$it" } ?: UNKNOWN_VALUE,
        detail = when {
            unread == null -> UNREAD_HINT
            unread == 0 -> "暂无未读公告"
            else -> "$unread 条公告尚未阅读"
        },
        icon = MiuixIcons.Promotions,
        tone = when {
            unread == null -> palette.muted
            unread > 0 -> palette.primary
            else -> palette.success
        },
        onClick = onNotices,
    ))
}

/** 定位概览与指标块同结构，因此同高：小标签 + 状态 + 两行说明位。 */
private fun locationBlock(location: LocationOverview, palette: OverviewPalette) = OverviewBlock(
    label = "位置上报",
    value = location.status,
    detail = location.hint,
    icon = null,
    tone = palette.primary,
    onClick = null,
)

/** 定位概览排第一页，其余每页 2 项；页序在进入 pager 前定型。 */
private fun overviewPages(
    blocks: List<OverviewBlock>,
    location: LocationOverview?,
    palette: OverviewPalette,
): List<List<OverviewBlock>> = buildList {
    location?.let { add(listOf(locationBlock(it, palette))) }
    blocks.chunked(BLOCKS_PER_PAGE).forEach { add(it) }
}

/**
 * 首页概览：定位概览卡与指标卡同处一组左右横划的整宽浅色卡（与「定位上报」同形态），
 * 每张卡并排放 2 项，兼顾信息密度与单页可读性。
 */
@Composable
internal fun HomeOverviewSection(
    overview: HomeOverview?, supervised: Boolean, loading: Boolean, error: String?,
    updatedAt: String?, location: LocationOverview?, onRefresh: () -> Unit,
    onNavigate: (MainTab) -> Unit, onNotices: () -> Unit,
) {
    val scheme = MiuixTheme.colorScheme
    val palette = OverviewPalette(primary = scheme.primary, error = scheme.error,
        success = AppColors.success, warning = AppColors.warning, muted = scheme.onSurfaceVariantSummary)
    val pages = overviewPages(
        overviewBlocks(overview, supervised, palette, onNavigate, onNotices), location, palette,
    )

    Column {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                SectionTitle("信息概览")
                Text(updatedAt?.let { "$it 更新" } ?: "今日安排与办理进度",
                    style = MiuixTheme.textStyles.footnote2,
                    color = scheme.onSurfaceVariantSummary,
                    modifier = Modifier.padding(start = AppSpace.inset, bottom = AppSpace.small))
            }
            TextButton(text = if (loading) "刷新中…" else "刷新", enabled = !loading, onClick = onRefresh,
                colors = ButtonDefaults.textButtonColors(color = Color.Transparent,
                    textColor = scheme.primary))
        }
        // A fixed progress slot preserves the list position while counts update.
        Box(Modifier.fillMaxWidth().height(4.dp)) {
            if (loading) LinearProgressIndicator(height = 2.dp)
        }
        Spacer(Modifier.height(AppSpace.small))
        if (error != null) {
            Card(modifier = Modifier.fillMaxWidth(), cornerRadius = AppShape.group,
                insideMargin = PaddingValues(0.dp)) {
                NoticeBanner(
                    if (overview == null) "概览暂不可用，请点击刷新重试。" else "刷新失败，以下为上次读取的信息。",
                    error = true,
                )
            }
            Spacer(Modifier.height(AppSpace.medium))
        }
        val pager = rememberPagerState { pages.size }
        HorizontalPager(
            state = pager,
            pageSpacing = AppSpace.medium,
            // 预组合相邻页：各页卡片结构一致、高度相同，这里只是让横划时视口高度提前稳定。
            beyondViewportPageCount = 1,
            verticalAlignment = Alignment.Top,
            modifier = Modifier.fillMaxWidth(),
        ) { index ->
            OverviewCard(pages[index])
        }
        if (pages.size > 1) PagerDots(count = pages.size, pager = pager)
    }
}

/**
 * 一张卡并排多个块：与打卡页「今日进度」卡同一套做法（纯间距分栏，不加竖线，
 * 避免在懒加载项里引入 intrinsic 测量）。
 */
@Composable
private fun OverviewCard(blocks: List<OverviewBlock>, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.fillMaxWidth(),
        cornerRadius = AppShape.group,
        insideMargin = PaddingValues(AppSpace.inset),
        colors = CardDefaults.defaultColors(
            color = MiuixTheme.colorScheme.primary.copy(alpha = 0.10f)),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(AppSpace.page)) {
            blocks.forEach { block -> MetricBlock(block, Modifier.weight(1f)) }
        }
    }
}

@Composable
private fun MetricBlock(block: OverviewBlock, modifier: Modifier = Modifier) {
    val scheme = MiuixTheme.colorScheme
    val duration = if (LocalEffects.current.reduceMotion) 0 else 180
    val onClick = block.onClick
    Column(modifier.then(
        if (onClick == null) Modifier
        else Modifier.clickable(role = Role.Button, onClickLabel = "查看${block.label}", onClick = onClick),
    )) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(AppSpace.tiny)) {
            Text(block.label, style = MiuixTheme.textStyles.footnote1,
                color = scheme.onSurfaceVariantSummary, modifier = Modifier.weight(1f))
            block.icon?.let {
                Icon(it, contentDescription = null, modifier = Modifier.size(16.dp), tint = block.tone)
            }
        }
        Spacer(Modifier.height(AppSpace.small))
        AnimatedContent(targetState = block.value,
            transitionSpec = { fadeIn(tween(duration)) togetherWith fadeOut(tween(duration)) using null },
            label = "overview-value") { value ->
            Text(value, style = MiuixTheme.textStyles.title2, color = block.tone, maxLines = 1)
        }
        Spacer(Modifier.height(AppSpace.tiny))
        // 固定两行说明位：同卡两块、以及左右各页的文案长短不一，卡片高度都不会跟着跳。
        Text(block.detail, style = MiuixTheme.textStyles.footnote2,
            color = scheme.onSurfaceVariantSummary,
            minLines = 2, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * 活动条是一个独立元素，位置由 pager 的连续偏移直接驱动
 * （[PagerState.currentPage] + [PagerState.currentPageOffsetFraction]），因此它跟着手指滑动。
 *
 * 关键在于它是**会形变**的，不是一根固定宽度的小棍平移：圆点间距只有 12dp，
 * 若宽度恒定，滑到两点中间时会把左右两个点各盖掉一半（看着像两块半月牙，又硬又乱）。
 * 这里让宽度在过渡中途涨到能同时包住相邻两点（`sin` 在两端为 0、中点最大，落位即收回），
 * 于是观感是"流过去"而不是"卡过去"。
 *
 * 位置与宽度都在绘制阶段算（`drawBehind` 读偏移只失效绘制，不触发重组），
 * 与底部标签栏 GlassTabIndicator 同一套"把状态读取推迟到绘制/放置阶段"的做法。
 */
@Composable
private fun PagerDots(count: Int, pager: PagerState) {
    val scheme = MiuixTheme.colorScheme
    val reduceMotion = LocalEffects.current.reduceMotion
    val dot = 6.dp
    val gap = 6.dp
    // 静止时活动条 = 圆点 + 两端各 inset。这里取 12dp（圆点 2 倍），18dp 会显得太长。
    // 下限是圆点大小 6dp：过渡中点宽度为 pill + cell，必须不小于两点并集 cell + dot，
    // 即 pill >= dot，否则又会退回"两点各盖一半"。6~18dp 之间都可调。
    val pill = 12.dp
    val inset = (pill - dot) / 2
    val cell = dot + gap
    val inactive = scheme.onSurfaceVariantSummary.copy(alpha = 0.24f)
    val active = scheme.primary
    // 容器高度就是圆点高度：活动条本身只有 dot 高，留 18dp 会在上下各多出 6dp 空白，
    // 把卡片和指示器、指示器和下方按钮推得更远。
    Box(Modifier.fillMaxWidth().padding(top = AppSpace.small).height(dot),
        contentAlignment = Alignment.Center) {
        Box(Modifier.width(cell * count - gap + inset * 2).height(dot)) {
            Row(Modifier.align(Alignment.CenterStart).offset(x = inset),
                horizontalArrangement = Arrangement.spacedBy(gap),
                verticalAlignment = Alignment.CenterVertically) {
                repeat(count) {
                    Box(Modifier.size(dot).clip(CircleShape).background(inactive))
                }
            }
            Box(Modifier.matchParentSize().drawBehind {
                val dotPx = dot.toPx()
                val cellPx = cell.toPx()
                // 越界回弹时页码偏移会超出首尾，夹住它，活动条就不会飞出轨道。
                val position = if (reduceMotion) pager.currentPage.toFloat()
                else (pager.currentPage + pager.currentPageOffsetFraction)
                    .coerceIn(0f, (count - 1).toFloat())
                val width = pill.toPx() + cellPx * sin(PI * (position - floor(position))).toFloat()
                val left = inset.toPx() + position * cellPx + (dotPx - width) / 2f
                drawRoundRect(
                    color = active,
                    topLeft = Offset(left, (size.height - dotPx) / 2f),
                    size = Size(width, dotPx),
                    cornerRadius = CornerRadius(dotPx / 2f),
                )
            })
        }
    }
}
