package com.custodysim.app.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EffectsPolicyTest {
    @Test fun blurOnlyDevicesUseSoftRatherThanClaimingLiquidGlass() {
        assertEquals(EffectsLevel.SOFT,
            resolveEffectsLevel(EffectsLevel.GLASS, true, false, false, supportsRefraction = false))
        assertEquals(EffectsLevel.GLASS,
            resolveEffectsLevel(EffectsLevel.GLASS, true, false, false, supportsRefraction = true))
    }
    @Test fun explicitOffWinsOverEverySystemPolicy() {
        for (supported in listOf(false, true)) for (powerSaving in listOf(false, true)) {
            for (reduceMotion in listOf(false, true)) {
                assertEquals(EffectsLevel.OFF, resolveEffectsLevel(EffectsLevel.OFF, supported, powerSaving, reduceMotion))
            }
        }
    }

    @Test fun unsupportedDeviceNeverEnablesRealBlur() {
        assertEquals(EffectsLevel.SOFT, resolveEffectsLevel(EffectsLevel.GLASS, false, false, false))
        assertEquals(EffectsLevel.OFF, resolveEffectsLevel(EffectsLevel.GLASS, false, true, false))
    }

    @Test fun combinedSystemLimitsDowngradeOnlyOnce() {
        assertEquals(EffectsLevel.SOFT, resolveEffectsLevel(EffectsLevel.GLASS, true, true, true))
        assertEquals(EffectsLevel.OFF, resolveEffectsLevel(EffectsLevel.SOFT, true, false, true))
        assertEquals(EffectsLevel.GLASS, resolveEffectsLevel(EffectsLevel.GLASS, true, false, false))
    }

    @Test fun switchingOffKeepsTheUsersPreferredLevel() {
        var saved = EffectsLevel.OFF
        val state = EffectsState(EffectsLevel.SOFT, EffectsLevel.SOFT) { _, enabled -> saved = enabled }
        state.setEnabled(false)
        assertEquals(EffectsLevel.OFF, state.level)
        state.setEnabled(true)
        assertEquals(EffectsLevel.SOFT, state.level)
        assertEquals(EffectsLevel.SOFT, saved)
    }

    @Test fun onlyTwoSurfacesCanBlurAndReleasedSlotsAreReused() {
        val state = EffectsState(EffectsLevel.GLASS, EffectsLevel.GLASS) { _, _ -> }
        val owners = List(3) { Any() }
        owners.forEach(state::registerSurface)
        assertTrue(state.hasBlurSlot(owners[0]))
        assertTrue(state.hasBlurSlot(owners[1]))
        assertFalse(state.hasBlurSlot(owners[2]))
        state.unregisterSurface(owners[0])
        assertTrue(state.hasBlurSlot(owners[2]))
        owners.forEach(state::unregisterSurface)
        assertFalse(state.hasBlurSurfaces)
    }


}

