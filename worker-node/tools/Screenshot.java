import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.Toolkit;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * Grabs the virtual display from inside a worker container.
 *
 * Used by ops verification because there is no `import`/`scrot` in the image and
 * the RFB port is loopback-only. Robot works against the X server directly, so
 * the resulting PNG is exactly what a VNC client would receive — pixels on the
 * framebuffer, not a screenshot of a window that may not be mapped.
 *
 *   javac -d /tmp Screenshot.java
 *   DISPLAY=:1 java -cp /tmp Screenshot /tmp/shot.png
 */
public class Screenshot {
    public static void main(String[] args) throws Exception {
        String out = args.length > 0 ? args[0] : "/tmp/shot.png";
        Rectangle bounds = new Rectangle(Toolkit.getDefaultToolkit().getScreenSize());
        BufferedImage img = new Robot().createScreenCapture(bounds);
        ImageIO.write(img, "png", new File(out));
        System.out.println("captured " + bounds.width + "x" + bounds.height + " -> " + out);
    }
}
