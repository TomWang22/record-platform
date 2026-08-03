// Gate5 v7: createAcls from expected JSON, then describeAcls as canonical JSON.
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.admin.CreateAclsResult;
import org.apache.kafka.clients.admin.DescribeAclsResult;
import org.apache.kafka.common.acl.AccessControlEntry;
import org.apache.kafka.common.acl.AclBinding;
import org.apache.kafka.common.acl.AclBindingFilter;
import org.apache.kafka.common.acl.AclOperation;
import org.apache.kafka.common.acl.AclPermissionType;
import org.apache.kafka.common.resource.PatternType;
import org.apache.kafka.common.resource.ResourcePattern;
import org.apache.kafka.common.resource.ResourceType;

public class Gate5V7ApplyAndDescribeAcls {
  private static String esc(String s) {
    if (s == null) return "";
    return s.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static String jsonBinding(AclBinding b) {
    return "{"
        + "\"resource_type\":\"" + esc(b.pattern().resourceType().name()) + "\","
        + "\"resource_name\":\"" + esc(b.pattern().name()) + "\","
        + "\"resource_pattern_type\":\"" + esc(b.pattern().patternType().name()) + "\","
        + "\"principal\":\"" + esc(b.entry().principal()) + "\","
        + "\"host\":\"" + esc(b.entry().host()) + "\","
        + "\"operation\":\"" + esc(b.entry().operation().name()) + "\","
        + "\"permission_type\":\"" + esc(b.entry().permissionType().name()) + "\""
        + "}";
  }

  /** Minimal JSON array-of-objects parser for our fixed schema. */
  private static List<AclBinding> parseExpected(String json) {
    List<AclBinding> out = new ArrayList<>();
    String[] objs = json.split("\\{");
    for (String obj : objs) {
      if (!obj.contains("resource_type")) continue;
      ResourcePattern pattern =
          new ResourcePattern(
              ResourceType.valueOf(field(obj, "resource_type")),
              field(obj, "resource_name"),
              PatternType.valueOf(field(obj, "resource_pattern_type")));
      AccessControlEntry entry =
          new AccessControlEntry(
              field(obj, "principal"),
              field(obj, "host"),
              AclOperation.valueOf(field(obj, "operation")),
              AclPermissionType.valueOf(field(obj, "permission_type")));
      out.add(new AclBinding(pattern, entry));
    }
    return out;
  }

  private static String field(String obj, String key) {
    String needle = "\"" + key + "\":\"";
    int i = obj.indexOf(needle);
    if (i < 0) {
      needle = "\"" + key + "\": \"";
      i = obj.indexOf(needle);
    }
    if (i < 0) throw new IllegalArgumentException("missing field " + key);
    int start = i + needle.length();
    int end = obj.indexOf('"', start);
    return obj.substring(start, end);
  }

  public static void main(String[] args) throws Exception {
    if (args.length < 3) {
      System.err.println(
          "usage: Gate5V7ApplyAndDescribeAcls <bootstrap> <command-config> <expected.json>");
      System.exit(2);
    }
    String bootstrap = args[0];
    Path expectedPath = Path.of(args[2]);
    Properties props = new Properties();
    props.put(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap);
    props.put(AdminClientConfig.REQUEST_TIMEOUT_MS_CONFIG, "30000");
    props.put(AdminClientConfig.DEFAULT_API_TIMEOUT_MS_CONFIG, "120000");
    try (java.io.FileInputStream in = new java.io.FileInputStream(args[1])) {
      props.load(in);
    }
    long timeoutSec =
        Long.parseLong(System.getenv().getOrDefault("RP_GATE5_V7_ACL_DESCRIBE_TIMEOUT_SEC", "120"));
    List<AclBinding> expected = parseExpected(Files.readString(expectedPath, StandardCharsets.UTF_8));
    System.out.println("EXPECTED_BINDING_COUNT=" + expected.size());

    try (AdminClient admin = AdminClient.create(props)) {
      CreateAclsResult create = admin.createAcls(expected);
      create.all().get(timeoutSec, TimeUnit.SECONDS);
      System.out.println("ACL_CREATE_OK");

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

      Set<String> seen = new LinkedHashSet<>();
      List<String> lines = new ArrayList<>();
      for (AclBinding b : sorted) {
        String line = jsonBinding(b);
        if (seen.add(line)) lines.add(line);
      }
      System.out.println("ACL_JSON_BEGIN");
      System.out.println("[");
      for (int i = 0; i < lines.size(); i++) {
        System.out.print(lines.get(i));
        if (i + 1 < lines.size()) System.out.println(",");
        else System.out.println();
      }
      System.out.println("]");
      System.out.println("ACL_JSON_END");
      System.out.println("ACL_BINDING_COUNT=" + lines.size());
    }
  }
}
