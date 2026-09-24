package com.custodysim.app.ui.common

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.custodysim.app.R
import com.custodysim.app.ui.theme.AppShape
import com.custodysim.app.ui.theme.AppSpace
import top.yukonga.miuix.kmp.basic.*
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** Keep native Miuix field behavior with a quieter fill on cards and sheets. */
@Composable
fun softTextFieldColors(): TextFieldColors = TextFieldDefaults.textFieldColors(
    backgroundColor = MiuixTheme.colorScheme.primary.copy(alpha = 0.055f),
    labelColor = MiuixTheme.colorScheme.onSurfaceVariantSummary,
    borderColor = MiuixTheme.colorScheme.primary,
)

@Composable
fun SettingGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier = modifier.fillMaxWidth(), cornerRadius = AppShape.group,
        insideMargin = PaddingValues(0.dp), content = content)
}

/** One lazy item in a continuous group, with rounded outer edges only. */
@Composable
fun GroupedListItem(first: Boolean, last: Boolean, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val top = if (first) AppShape.group else 0.dp
    val bottom = if (last) AppShape.group else 0.dp
    Column(modifier.fillMaxWidth().animateContentSize().clip(RoundedCornerShape(top, top, bottom, bottom))
        .background(MiuixTheme.colorScheme.background), content = content)
}

@Composable
fun SectionTitle(text: String) {
    Text(text, style = MiuixTheme.textStyles.footnote1,
        color = MiuixTheme.colorScheme.onBackgroundVariant,
        modifier = Modifier.padding(start = AppSpace.inset, top = AppSpace.small, bottom = AppSpace.small))
}

/** Keep list utilities secondary to the actual records. */
@Composable
fun ListHeader(description: String, title: String, loading: Boolean, onRefresh: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(description, style = MiuixTheme.textStyles.footnote1,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            modifier = Modifier.padding(horizontal = AppSpace.inset, vertical = AppSpace.small))
        Row(Modifier.fillMaxWidth().padding(start = AppSpace.inset, bottom = AppSpace.small),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(AppSpace.small)) {
            Text(title, style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onBackgroundVariant, modifier = Modifier.weight(1f))
            TextButton(text = stringResource(if (loading) R.string.loading else R.string.refresh),
                enabled = !loading, onClick = onRefresh,
                colors = ButtonDefaults.textButtonColors(color = androidx.compose.ui.graphics.Color.Transparent,
                    textColor = MiuixTheme.colorScheme.primary))
        }
    }
}

@Composable
fun CompactAction(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        minWidth = 0.dp,
        minHeight = 44.dp,
        insideMargin = PaddingValues(horizontal = AppSpace.page, vertical = AppSpace.small),
        cornerRadius = AppShape.control,
        colors = ButtonDefaults.buttonColorsPrimary(),
    ) {
        AnimatedContent(
            targetState = text,
            transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.92f)) togetherWith (fadeOut() + scaleOut(targetScale = 0.92f)) },
            label = "compact-action-label",
        ) { label -> Text(label, style = MiuixTheme.textStyles.button,
            color = MiuixTheme.colorScheme.onPrimary) }
    }
}

/** A trailing action on phones; stack it below the content when text needs more room. */
@Composable
fun RecordContent(actionLabel: String?, onAction: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val fontScale = LocalDensity.current.fontScale
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth >= 300.dp && fontScale <= 1.3f && actionLabel != null) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(AppSpace.medium)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AppSpace.small), content = content)
                CompactAction(text = actionLabel, onClick = onAction)
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(AppSpace.small)) {
                content()
                if (actionLabel != null) CompactAction(text = actionLabel, onClick = onAction)
            }
        }
    }
}

/** Values stack below labels so long identifiers and large fonts never collide. */
@Composable
fun InfoRow(label: String, value: String) {
    BasicComponent(title = label, summary = value)
}

@Composable
fun NoticeBanner(text: String, error: Boolean = false) {
    AnimatedContent(
        targetState = text to error,
        transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.96f)) togetherWith fadeOut() },
        label = "notice-transition",
    ) { (message, isError) ->
        Text(message, style = MiuixTheme.textStyles.footnote1,
            color = if (isError) MiuixTheme.colorScheme.error else MiuixTheme.colorScheme.onSurfaceVariantSummary,
            modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }.padding(AppSpace.page))
    }
}

@Composable
fun PageState(title: String, description: String? = null, loading: Boolean = false, onRetry: (() -> Unit)? = null) {
    SettingGroup {
        Column(Modifier.fillMaxWidth().padding(AppSpace.large),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(AppSpace.page)) {
            if (loading) CircularProgressIndicator()
            Text(title, style = MiuixTheme.textStyles.body1, textAlign = TextAlign.Center,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            description?.let { Text(it, style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary, textAlign = TextAlign.Center) }
            onRetry?.let { TextButton(text = stringResource(R.string.retry), onClick = it, colors = ButtonDefaults.textButtonColorsPrimary()) }
        }
    }
}

@Composable
fun PrimaryAction(text: String, busy: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled && !busy, modifier = Modifier.fillMaxWidth(),
        minHeight = 52.dp, cornerRadius = AppShape.control,
        colors = ButtonDefaults.buttonColorsPrimary()) {
        AnimatedContent(
            targetState = busy,
            transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.88f)) togetherWith (fadeOut() + scaleOut(targetScale = 0.88f)) },
            label = "primary-action-state",
        ) { isBusy ->
            if (isBusy) {
                CircularProgressIndicator()
            } else {
                Text(text, style = MiuixTheme.textStyles.button, color = MiuixTheme.colorScheme.onPrimary)
            }
        }
    }
}
