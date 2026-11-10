package ai.offgridmobile.photoeditor

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.media.ExifInterface
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The crop -> model -> paste-back pipeline on real Android graphics: only the painted area
 * changes, the edge is feathered, and EXIF-rotated photos are edited where the user painted.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RegionPipelineTest {
    private val green = Color.rgb(0, 255, 0)
    private val grey = Color.rgb(128, 128, 128)

    private fun photo(w: Int, h: Int) = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { eraseColor(grey) }

    /** A fake model that paints the whole crop green, and records the input sizes it was given. */
    private val sizes = mutableListOf<Int>()
    private val fakeModel: (Bitmap, Bitmap) -> Bitmap = { crop, mask ->
        sizes += crop.width; sizes += mask.width
        Bitmap.createBitmap(crop.width, crop.height, Bitmap.Config.ARGB_8888).apply { Canvas(this).drawColor(green) }
    }

    /** A short horizontal stroke centred on (u, v), 5% of the image width thick. */
    private fun dab(u: Float, v: Float) = Stroke(erase = false, size = 0.05f, points = floatArrayOf(u - 0.02f, v, u + 0.02f, v))

    @Test
    fun onlyThePaintedAreaChanges_andTheEdgeIsSoft() {
        val image = photo(4000, 3000)
        val map = OrientationMap(4000, 3000, ExifInterface.ORIENTATION_NORMAL)
        val result = RegionPipeline.process(image, listOf(dab(0.25f, 0.5f)), map, 512, fakeModel)

        assertEquals(listOf(512, 512), sizes)
        assertEquals(green, image.getPixel(1000, 1500))           // painted centre: replaced
        assertEquals(grey, image.getPixel(3000, 1500))            // far away: untouched
        assertEquals(grey, image.getPixel(1000, 1100))            // inside the crop but outside the paint
        val crop = result.crop
        assertEquals(crop.width(), crop.height())                 // square crop with padding
        assertTrue(crop.contains(1000, 1500))
        // Somewhere between the painted core and the untouched area there is a blended pixel.
        val column = (1500 downTo 1300).map { image.getPixel(1000, it) }
        assertTrue("expected a feathered edge", column.any { it != green && it != grey })
    }

    @Test
    fun rotatedPhoto_isEditedWhereTheUserPainted() {
        // Stored 3000x4000 with ROTATE_90: the user saw (and painted on) a 4000x3000 upright image.
        val raw = photo(3000, 4000)
        val map = OrientationMap(3000, 4000, ExifInterface.ORIENTATION_ROTATE_90)
        assertEquals(4000, map.uprightW); assertEquals(3000, map.uprightH)
        // Paint near the upright top-left corner (u=0.1, v=0.1 -> upright pixel 400, 300).
        RegionPipeline.process(raw, listOf(dab(0.1f, 0.1f)), map, 512, fakeModel)
        // Displaying raw rotated 90 degrees clockwise puts upright (x, y) at raw (y, H_raw - 1 - x).
        assertEquals(green, raw.getPixel(300, 4000 - 1 - 400))
        assertEquals(grey, raw.getPixel(300, 400))                // the unrotated position stays untouched
    }

    @Test
    fun eraserStrokesRemovePaint() {
        val image = photo(2000, 2000)
        val map = OrientationMap(2000, 2000, ExifInterface.ORIENTATION_NORMAL)
        val brush = Stroke(false, 0.1f, floatArrayOf(0.3f, 0.5f, 0.7f, 0.5f))
        val eraser = Stroke(true, 0.15f, floatArrayOf(0.5f, 0.5f, 0.5001f, 0.5f))
        RegionPipeline.process(image, listOf(brush, eraser), map, 512, fakeModel)
        assertEquals(green, image.getPixel(700, 1000))
        assertEquals(grey, image.getPixel(1000, 1000))            // erased in the middle
    }
}
