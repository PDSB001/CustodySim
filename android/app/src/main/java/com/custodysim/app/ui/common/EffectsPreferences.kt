package com.custodysim.app.ui.common

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.custodysim.app.R
import com.custodysim.app.ui.theme.EffectsLevel
import com.custodysim.app.ui.theme.LocalEffects
import top.yukonga.miuix.kmp.basic.DropdownItem
import top.yukonga.miuix.kmp.preference.OverlaySpinnerPreference
import top.yukonga.miuix.kmp.preference.SwitchPreference

@Composable
fun EffectsPreferences() {
    val effects = LocalEffects.current
    val effective = effects.effectiveLevel
    val summary = when {
        effects.level == EffectsLevel.OFF -> R.string.effects_off_summary
        effects.powerSaving || effects.reduceMotion -> if (effective == EffectsLevel.OFF)
            R.string.effects_system_off_summary else R.string.effects_system_soft_summary
        effects.level == EffectsLevel.GLASS && !effects.supportsRefraction -> R.string.effects_unsupported_summary
        effective == EffectsLevel.GLASS -> R.string.effects_glass_summary
        else -> R.string.effects_soft_summary
    }
    Column {
        SectionTitle(stringResource(R.string.effects_title))
        SettingGroup {
            SwitchPreference(title = stringResource(R.string.effects_switch),
                summary = stringResource(summary),
                checked = effects.level != EffectsLevel.OFF,
                onCheckedChange = effects::setEnabled)
            OverlaySpinnerPreference(
                title = stringResource(R.string.effects_level),
                items = listOf(DropdownItem(text = stringResource(R.string.effects_soft)),
                    DropdownItem(text = stringResource(R.string.effects_glass))),
                selectedIndex = if (effects.enabledLevel == EffectsLevel.GLASS) 1 else 0,
                enabled = effects.level != EffectsLevel.OFF,
                onSelectedIndexChange = { effects.select(if (it == 1) EffectsLevel.GLASS else EffectsLevel.SOFT) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
