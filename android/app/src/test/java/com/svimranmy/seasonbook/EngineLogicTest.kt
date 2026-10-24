package com.svimranmy.seasonbook

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// CI runs this on every push touching android/** — the pure notification logic stays provable
// even while the on-device half needs hands-on OEM checks (stock / Samsung / Xiaomi).

class EngineLogicTest {

    @Test
    fun `codes format as SxxEyy with specials falling back`() {
        assertEquals("S05E16", EngineLogic.code(5, 16))
        assertEquals("S00E00", EngineLogic.code(0, 0))
        assertEquals("S2 special", EngineLogic.code(2, null))
        assertEquals("Special", EngineLogic.code(null, null))
    }

    @Test
    fun `titles follow the contract show · SxxEyy`() {
        assertEquals("Breaking Bad · S05E16", EngineLogic.title("Breaking Bad", 5, 16))
        assertEquals("Show · Special", EngineLogic.title("Show", null, null))
    }

    @Test
    fun `lead labels bucket 2h 1h minutes now`() {
        assertEquals("starts now", EngineLogic.leadLabel(0))
        assertEquals("starts now", EngineLogic.leadLabel(-5))
        assertEquals("starts in 30 min", EngineLogic.leadLabel(30))
        assertEquals("starts in 54 min", EngineLogic.leadLabel(54))
        assertEquals("starts in ~1 h", EngineLogic.leadLabel(55))
        assertEquals("starts in ~1 h", EngineLogic.leadLabel(109))
        assertEquals("starts in ~2 h", EngineLogic.leadLabel(110))
    }

    @Test
    fun `quiet hours are 22-07 local`() {
        for (h in listOf(22, 23, 0, 3, 6)) assertTrue("hour $h should be quiet", EngineLogic.isQuietHour(h))
        for (h in listOf(7, 12, 18, 21)) assertFalse("hour $h should not be quiet", EngineLogic.isQuietHour(h))
    }

    @Test
    fun `iso air_utc parses and garbage returns null`() {
        assertEquals(1380544800000L, EngineLogic.parseIsoToMillis("2013-09-30T02:00:00Z"))
        assertEquals(1380544800000L, EngineLogic.parseIsoToMillis("2013-09-30T02:00:00.000Z"))
        assertNull(EngineLogic.parseIsoToMillis("tbd"))
        assertNull(EngineLogic.parseIsoToMillis(""))
    }

    @Test
    fun `bodies carry fact + offset + network`() {
        assertTrue(EngineLogic.body("Felina", 30, "AMC").contains("Felina"))
        assertTrue(EngineLogic.body("Felina", 30, "AMC").contains("starts in 30 min"))
        assertTrue(EngineLogic.body("Felina", 30, "AMC").contains("on AMC"))
        assertTrue(EngineLogic.body(null, 120, null).contains("New episode"))
        assertTrue(EngineLogic.body(null, 120, null).contains("~2 h"))
    }
}
