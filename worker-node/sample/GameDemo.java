import javax.swing.*;
import java.awt.*;
import java.awt.event.*;

/**
 * Minimal Java GUI used to prove a worker container is actually rendering:
 * a moving sprite, a live clock and key/mouse echo. Compiled with
 * `--release 8` so it also runs on the OpenJDK 8 image variant.
 */
public class GameDemo extends JPanel implements ActionListener, KeyListener {
    private int x = 40, y = 60, dx = 3, dy = 2;
    private int keyPresses = 0;
    private int clicks = 0;
    private final Timer timer;
    private long startedAt = System.currentTimeMillis();

    public GameDemo() {
        setPreferredSize(new Dimension(640, 400));
        setBackground(new Color(0x0F172A));
        setFocusable(true);
        addKeyListener(this);
        addMouseListener(new MouseAdapter() {
            @Override public void mousePressed(MouseEvent e) {
                clicks++;
                x = e.getX();
                y = e.getY();
            }
        });
        timer = new Timer(16, this); // ~60 fps
        timer.start();
    }

    @Override public void actionPerformed(ActionEvent e) {
        x += dx;
        y += dy;
        if (x < 0 || x > getWidth() - 60) dx = -dx;
        if (y < 0 || y > getHeight() - 60) dy = -dy;
        repaint();
    }

    @Override protected void paintComponent(Graphics g0) {
        super.paintComponent(g0);
        Graphics2D g = (Graphics2D) g0;
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

        g.setColor(new Color(0x6366F1));
        g.fillRoundRect(x, y, 60, 60, 14, 14);

        g.setColor(new Color(0xE2E8F0));
        g.setFont(new Font("DejaVu Sans", Font.BOLD, 20));
        g.drawString("CloudJava VNC — worker online", 24, 34);

        g.setColor(new Color(0x10B981));
        g.setFont(new Font("DejaVu Sans", Font.PLAIN, 13));
        g.drawString("JVM " + System.getProperty("java.version")
                + "   up " + ((System.currentTimeMillis() - startedAt) / 1000) + "s", 24, 56);

        g.setColor(new Color(0x94A3B8));
        g.drawString("keys=" + keyPresses + "  clicks=" + clicks
                + "  (click to teleport, type to count)", 24, getHeight() - 20);
    }

    @Override public void keyPressed(KeyEvent e) { keyPresses++; }
    @Override public void keyReleased(KeyEvent e) { }
    @Override public void keyTyped(KeyEvent e) { }

    public static void main(String[] args) {
        // AWT on a headless X server needs this to avoid reparenting quirks
        System.setProperty("_JAVA_AWT_WM_NONREPARENTING", "1");
        SwingUtilities.invokeLater(new Runnable() {
            public void run() {
                JFrame frame = new JFrame("CloudJava VNC");
                frame.setDefaultCloseOperation(JFrame.DO_NOTHING_ON_CLOSE);
                frame.setUndecorated(true);
                frame.setContentPane(new GameDemo());
                frame.pack();
                frame.setLocation(0, 0);
                frame.setVisible(true);
            }
        });
    }
}
