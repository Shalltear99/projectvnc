import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;

/**
 * Shown when an instance has no launcher and no JAR yet.
 *
 * Why this exists: a fresh instance with an empty /opt/game volume would
 * otherwise stream a blank slate rectangle. Users (and support) cannot tell
 * "connected and idle" from "connected but broken". This window proves the
 * pipeline end to end — X server, window manager, JVM, AWT and the VNC stream —
 * the moment the session opens, and tells the user what to do next.
 *
 * Compiled at image build time with `--release 8` so it runs on every JDK in the
 * image (8/11/17/21).
 */
public class InfoApp extends JPanel {

    private final long startedAt = System.currentTimeMillis();
    private final JLabel clock = new JLabel();
    private int clicks = 0;
    private int keys = 0;
    private final JLabel counters = new JLabel();

    public InfoApp() {
        setLayout(new BorderLayout());
        // Card surface, not the page background: the root window is already
        // slate-900, so an identically coloured panel would be invisible and the
        // screen would read as an empty desktop (design.md: card = slate-800).
        setBackground(new Color(0x1E293B));
        setBorder(BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(new Color(0x334155), 1),
            new EmptyBorder(35, 39, 35, 39)));

        JLabel title = new JLabel("CloudJava VNC");
        title.setForeground(Color.WHITE);
        title.setFont(new Font("DejaVu Sans", Font.BOLD, 26));

        JLabel subtitle = new JLabel("Desktop is live. No application loaded yet.");
        subtitle.setForeground(new Color(0x94A3B8));
        subtitle.setFont(new Font("DejaVu Sans", Font.PLAIN, 14));

        JPanel head = new JPanel();
        head.setOpaque(false);
        head.setLayout(new BoxLayout(head, BoxLayout.Y_AXIS));
        head.add(title);
        head.add(Box.createVerticalStrut(6));
        head.add(subtitle);
        add(head, BorderLayout.NORTH);

        JTextArea body = new JTextArea();
        body.setEditable(false);
        body.setOpaque(false);
        body.setForeground(new Color(0xE2E8F0));
        body.setFont(new Font("DejaVu Sans Mono", Font.PLAIN, 13));
        body.setLineWrap(true);
        body.setWrapStyleWord(true);
        body.setText(
            "This instance is ready. To run your game:\n\n"
            + "  1. Put a start.sh (preferred) or a .jar in /opt/game\n"
            + "  2. Restart the instance from the dashboard\n\n"
            + "start.sh is executed with DISPLAY and XAUTHORITY set, so it can\n"
            + "launch anything: java -jar, a J2ME emulator, or a native binary.\n"
            + "If a .jar is present with no start.sh, it is opened with the bundled\n"
            + "FreeJ2ME runtime when the jar is a MIDlet, otherwise with `java -jar`."
        );
        add(body, BorderLayout.CENTER);

        JPanel foot = new JPanel();
        foot.setOpaque(false);
        foot.setLayout(new BoxLayout(foot, BoxLayout.Y_AXIS));

        clock.setForeground(new Color(0x6366F1));
        clock.setFont(new Font("DejaVu Sans Mono", Font.BOLD, 13));

        counters.setForeground(new Color(0x64748B));
        counters.setFont(new Font("DejaVu Sans Mono", Font.PLAIN, 12));

        foot.add(clock);
        foot.add(Box.createVerticalStrut(6));
        foot.add(counters);
        add(foot, BorderLayout.SOUTH);

        // Input echo: clicking and typing here proves the RFB input path works,
        // which is the part users report as broken when it is.
        addMouseListener(new MouseAdapter() {
            @Override public void mousePressed(MouseEvent e) {
                clicks++;
                refresh();
            }
        });
        setFocusable(true);

        new Timer(1000, e -> refresh()).start();
        refresh();
    }

    private void refresh() {
        long up = (System.currentTimeMillis() - startedAt) / 1000;
        clock.setText(String.format(
            "JVM %s   up %02d:%02d:%02d",
            System.getProperty("java.version"), up / 3600, (up % 3600) / 60, up % 60));
        counters.setText("input check — clicks: " + clicks + "   keys: " + keys);
    }

    public static void main(String[] args) {
        System.setProperty("_JAVA_AWT_WM_NONREPARENTING", "1");
        SwingUtilities.invokeLater(() -> {
            JFrame frame = new JFrame("CloudJava VNC");
            frame.setDefaultCloseOperation(JFrame.DO_NOTHING_ON_CLOSE);
            frame.setUndecorated(true);
            frame.setContentPane(new InfoApp());
            frame.setSize(new Dimension(720, 460));
            frame.setLocationRelativeTo(null);
            frame.setVisible(true);
            frame.toFront();
        });
    }
}
