// Gate5 v7: emit normalized AclBinding JSON via AdminClient (exact-set verifier input).
// Compile/run inside cp-kafka image with Kafka classpath.
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.admin.DescribeAclsResult;
import org.apache.kafka.common.acl.AclBinding;
import org.apache.kafka.common.acl.AclBindingFilter;

public class Gate5V7DescribeAcls {
  private static String esc(String s) {
    if (s == null) return "";
    return s.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static String jsonBinding(AclBinding b) {
    String rt = b.pattern().resourceType().name();
    String name = b.pattern().name();
    String pattern = b.pattern().patternType().name();
    String principal = b.entry().principal();
    String host = b.entry().host();
    String op = b.entry().operation().name();
    String perm = b.entry().permissionType().name();
    return "{"
        + "\"resource_type\":\"" + esc(rt) + "\","
        + "\"resource_name\":\"" + esc(name) + "\","
        + "\"resource_pattern_type\":\"" + esc(pattern) + "\","
        + "\"principal\":\"" + esc(principal) + "\","
        + "\"host\":\"" + esc(host) + "\","
        + "\"operation\":\"" + esc(op) + "\","
        + "\"permission_type\":\"" + esc(perm) + "\""
        + "}";
  }

  public static void main(String[] args) throws Exception {
    if (args.length < 1) {
      System.err.println("usage: Gate5V7DescribeAcls <bootstrap> [command-config-path]");
      System.exit(2);
    }
    String bootstrap = args[0];
    Properties props = new Properties();
    props.put(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap);
    props.put(AdminClientConfig.REQUEST_TIMEOUT_MS_CONFIG, "20000");
    props.put(AdminClientConfig.DEFAULT_API_TIMEOUT_MS_CONFIG, "30000");
    if (args.length >= 2) {
      try (java.io.FileInputStream in = new java.io.FileInputStream(args[1])) {
        props.load(in);
      }
    }
    long timeoutSec = Long.parseLong(System.getenv().getOrDefault("RP_GATE5_V7_ACL_DESCRIBE_TIMEOUT_SEC", "45"));
    try (AdminClient admin = AdminClient.create(props)) {
      DescribeAclsResult result = admin.describeAcls(AclBindingFilter.ANY);
      Collection<AclBinding> bindings = result.values().get(timeoutSec, TimeUnit.SECONDS);
      List<AclBinding> sorted = new ArrayList<>(bindings);
      sorted.sort(
          Comparator.comparing((AclBinding b) -> b.pattern().resourceType().name())
              .thenComparing(b -> b.pattern().name())
              .thenComparing(b -> b.entry().principal())
              .thenComparing(b -> b.entry().operation().name())
              .thenComparing(b -> b.entry().permissionType().name())
              .thenComparing(b -> b.entry().host()));
      System.out.println("ACL_JSON_BEGIN");
      System.out.println("[");
      for (int i = 0; i < sorted.size(); i++) {
        System.out.print(jsonBinding(sorted.get(i)));
        if (i + 1 < sorted.size()) System.out.println(",");
        else System.out.println();
      }
      System.out.println("]");
      System.out.println("ACL_JSON_END");
      System.out.println("ACL_BINDING_COUNT=" + sorted.size());
    }
  }
}
