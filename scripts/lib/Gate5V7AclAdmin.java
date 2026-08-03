// Gate5 ACL AdminClient helper — modes: describe | apply | delete | reconcile
// Interchange: TSV with header resource_type...permission_type (tab-separated).
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileInputStream;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.admin.CreateAclsResult;
import org.apache.kafka.clients.admin.DeleteAclsResult;
import org.apache.kafka.clients.admin.DescribeAclsResult;
import org.apache.kafka.common.acl.AccessControlEntry;
import org.apache.kafka.common.acl.AccessControlEntryFilter;
import org.apache.kafka.common.acl.AclBinding;
import org.apache.kafka.common.acl.AclBindingFilter;
import org.apache.kafka.common.acl.AclOperation;
import org.apache.kafka.common.acl.AclPermissionType;
import org.apache.kafka.common.resource.PatternType;
import org.apache.kafka.common.resource.ResourcePattern;
import org.apache.kafka.common.resource.ResourcePatternFilter;
import org.apache.kafka.common.resource.ResourceType;

public class Gate5V7AclAdmin {
  private static final String[] FIELDS = {
    "resource_type",
    "resource_name",
    "resource_pattern_type",
    "principal",
    "host",
    "operation",
    "permission_type"
  };

  private static void fail(String msg) {
    System.err.println("FATAL: " + msg);
    System.exit(2);
  }

  private static String escJson(String s) {
    if (s == null) return "";
    return s.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static String jsonBinding(AclBinding b) {
    return "{"
        + "\"resource_type\":\"" + escJson(b.pattern().resourceType().name()) + "\","
        + "\"resource_name\":\"" + escJson(b.pattern().name()) + "\","
        + "\"resource_pattern_type\":\"" + escJson(b.pattern().patternType().name()) + "\","
        + "\"principal\":\"" + escJson(b.entry().principal()) + "\","
        + "\"host\":\"" + escJson(b.entry().host()) + "\","
        + "\"operation\":\"" + escJson(b.entry().operation().name()) + "\","
        + "\"permission_type\":\"" + escJson(b.entry().permissionType().name()) + "\""
        + "}";
  }

  private static String bindingKey(AclBinding b) {
    return b.pattern().resourceType().name()
        + "|" + b.pattern().name()
        + "|" + b.pattern().patternType().name()
        + "|" + b.entry().principal()
        + "|" + b.entry().host()
        + "|" + b.entry().operation().name()
        + "|" + b.entry().permissionType().name();
  }

  private static void rejectTabNewline(String v, String field) {
    if (v.indexOf('\t') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) {
      fail("tab/newline in field " + field);
    }
  }

  private static List<AclBinding> parseTsv(Path path) throws Exception {
    List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
    if (lines.isEmpty()) fail("empty TSV: " + path);
    String[] header = lines.get(0).split("\t", -1);
    if (header.length != FIELDS.length) fail("TSV header column count");
    for (int i = 0; i < FIELDS.length; i++) {
      if (!FIELDS[i].equals(header[i])) fail("TSV header mismatch at " + i);
    }
    List<AclBinding> out = new ArrayList<>();
    Map<String, Integer> seen = new HashMap<>();
    for (int ln = 1; ln < lines.size(); ln++) {
      String line = lines.get(ln);
      if (line.trim().isEmpty()) continue;
      String[] cols = line.split("\t", -1);
      if (cols.length != FIELDS.length) fail("TSV line " + (ln + 1) + " column count");
      for (int i = 0; i < cols.length; i++) rejectTabNewline(cols[i], FIELDS[i]);
      if (cols[3].isEmpty()) fail("empty principal line " + (ln + 1));
      ResourceType rt;
      PatternType pt;
      AclOperation op;
      AclPermissionType perm;
      try {
        rt = ResourceType.valueOf(cols[0]);
        pt = PatternType.valueOf(cols[2]);
        op = AclOperation.valueOf(cols[5]);
        perm = AclPermissionType.valueOf(cols[6]);
      } catch (IllegalArgumentException e) {
        fail("invalid enum line " + (ln + 1) + ": " + e.getMessage());
        return out;
      }
      if (pt == PatternType.ANY || pt == PatternType.MATCH) {
        fail("MATCH/ANY pattern forbidden in expected TSV line " + (ln + 1));
      }
      if (cols[4].isEmpty()) fail("malformed host line " + (ln + 1));
      AclBinding b =
          new AclBinding(
              new ResourcePattern(rt, cols[1], pt),
              new AccessControlEntry(cols[3], cols[4], op, perm));
      String key = bindingKey(b);
      seen.put(key, seen.getOrDefault(key, 0) + 1);
      out.add(b);
    }
    for (Map.Entry<String, Integer> e : seen.entrySet()) {
      if (e.getValue() > 1) fail("duplicate expected binding: " + e.getKey());
    }
    return out;
  }

  private static Properties loadProps(String bootstrap, String configPath) throws Exception {
    Properties props = new Properties();
    props.put(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap);
    props.put(AdminClientConfig.REQUEST_TIMEOUT_MS_CONFIG, "30000");
    props.put(AdminClientConfig.DEFAULT_API_TIMEOUT_MS_CONFIG, "120000");
    try (FileInputStream in = new FileInputStream(configPath)) {
      props.load(in);
    }
    return props;
  }

  private static long timeoutSec() {
    return Long.parseLong(System.getenv().getOrDefault("RP_GATE5_V7_ACL_DESCRIBE_TIMEOUT_SEC", "120"));
  }

  private static List<AclBinding> describeAll(AdminClient admin) throws Exception {
    DescribeAclsResult result = admin.describeAcls(AclBindingFilter.ANY);
    Collection<AclBinding> bindings = result.values().get(timeoutSec(), TimeUnit.SECONDS);
    List<AclBinding> sorted = new ArrayList<>(bindings);
    sorted.sort(
        Comparator.comparing((AclBinding b) -> b.pattern().resourceType().name())
            .thenComparing(b -> b.pattern().name())
            .thenComparing(b -> b.pattern().patternType().name())
            .thenComparing(b -> b.entry().principal())
            .thenComparing(b -> b.entry().operation().name())
            .thenComparing(b -> b.entry().permissionType().name())
            .thenComparing(b -> b.entry().host()));
    return sorted;
  }

  private static void emitDescribeJson(List<AclBinding> raw) {
    Map<String, Integer> counts = new LinkedHashMap<>();
    for (AclBinding b : raw) {
      String k = bindingKey(b);
      counts.put(k, counts.getOrDefault(k, 0) + 1);
    }
    List<String> dupKeys = new ArrayList<>();
    for (Map.Entry<String, Integer> e : counts.entrySet()) {
      if (e.getValue() > 1) dupKeys.add(e.getKey());
    }
    List<AclBinding> unique = new ArrayList<>();
    Map<String, Boolean> seen = new LinkedHashMap<>();
    for (AclBinding b : raw) {
      String k = bindingKey(b);
      if (!seen.containsKey(k)) {
        seen.put(k, true);
        unique.add(b);
      }
    }
    System.out.println("ACL_JSON_BEGIN");
    System.out.println("{");
    System.out.println("\"raw_binding_count\":" + raw.size() + ",");
    System.out.println("\"unique_binding_count\":" + unique.size() + ",");
    System.out.println("\"duplicate_binding_count\":" + dupKeys.size() + ",");
    System.out.print("\"duplicate_binding_keys\":[");
    for (int i = 0; i < dupKeys.size(); i++) {
      System.out.print("\"" + escJson(dupKeys.get(i)) + "\"");
      if (i + 1 < dupKeys.size()) System.out.print(",");
    }
    System.out.println("],");
    System.out.println("\"raw_bindings\":[");
    for (int i = 0; i < raw.size(); i++) {
      System.out.print(jsonBinding(raw.get(i)));
      if (i + 1 < raw.size()) System.out.println(",");
      else System.out.println();
    }
    System.out.println("],");
    System.out.println("\"canonical_bindings\":[");
    for (int i = 0; i < unique.size(); i++) {
      System.out.print(jsonBinding(unique.get(i)));
      if (i + 1 < unique.size()) System.out.println(",");
      else System.out.println();
    }
    System.out.println("]");
    System.out.println("}");
    System.out.println("ACL_JSON_END");
    System.out.println("RAW_BINDING_COUNT=" + raw.size());
    System.out.println("UNIQUE_BINDING_COUNT=" + unique.size());
    System.out.println("DUPLICATE_BINDING_COUNT=" + dupKeys.size());
  }

  private static AclBindingFilter exactFilter(AclBinding b) {
    return new AclBindingFilter(
        new ResourcePatternFilter(
            b.pattern().resourceType(), b.pattern().name(), b.pattern().patternType()),
        new AccessControlEntryFilter(
            b.entry().principal(),
            b.entry().host(),
            b.entry().operation(),
            b.entry().permissionType()));
  }

  private static void applyCreate(AdminClient admin, List<AclBinding> bindings) throws Exception {
    if (bindings.isEmpty()) {
      System.out.println("ACL_CREATE_OK count=0");
      return;
    }
    CreateAclsResult create = admin.createAcls(bindings);
    create.all().get(timeoutSec(), TimeUnit.SECONDS);
    System.out.println("ACL_CREATE_OK count=" + bindings.size());
  }

  private static void applyDelete(AdminClient admin, List<AclBinding> bindings) throws Exception {
    if (bindings.isEmpty()) {
      System.out.println("ACL_DELETE_OK count=0");
      return;
    }
    List<AclBindingFilter> filters = new ArrayList<>();
    for (AclBinding b : bindings) {
      if (b.pattern().patternType() == PatternType.ANY
          || b.pattern().patternType() == PatternType.MATCH) {
        fail("MATCH/ANY forbidden for exact deletion");
      }
      filters.add(exactFilter(b));
    }
    DeleteAclsResult del = admin.deleteAcls(filters);
    del.all().get(timeoutSec(), TimeUnit.SECONDS);
    System.out.println("ACL_DELETE_OK count=" + bindings.size());
  }

  private static List<AclBinding> parsePlanTsv(Path path, String actionWanted) throws Exception {
    // plan TSV: action\t + FIELDS
    List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
    if (lines.isEmpty()) return new ArrayList<>();
    String[] header = lines.get(0).split("\t", -1);
    if (header.length != FIELDS.length + 1 || !"action".equals(header[0])) {
      fail("plan TSV header must start with action");
    }
    Path tmp = Files.createTempFile("gate5-acl-plan-", ".tsv");
    try (PrintWriter w = new PrintWriter(new BufferedWriter(new FileWriter(tmp.toFile())))) {
      w.println(String.join("\t", FIELDS));
      for (int i = 1; i < lines.size(); i++) {
        String[] cols = lines.get(i).split("\t", -1);
        if (cols.length != FIELDS.length + 1) fail("plan TSV line " + (i + 1));
        if (!actionWanted.equals(cols[0])) continue;
        StringBuilder sb = new StringBuilder();
        for (int c = 1; c < cols.length; c++) {
          if (c > 1) sb.append('\t');
          sb.append(cols[c]);
        }
        w.println(sb);
      }
    }
    List<AclBinding> out = parseTsv(tmp);
    Files.deleteIfExists(tmp);
    return out;
  }

  public static void main(String[] args) throws Exception {
    if (args.length < 3) {
      System.err.println(
          "usage: Gate5V7AclAdmin <describe|apply|delete|reconcile> <bootstrap> <command-config> [tsv-or-plan]");
      System.exit(2);
    }
    String mode = args[0];
    String bootstrap = args[1];
    String config = args[2];
    Properties props = loadProps(bootstrap, config);
    try (AdminClient admin = AdminClient.create(props)) {
      if ("describe".equals(mode)) {
        List<AclBinding> raw = describeAll(admin);
        emitDescribeJson(raw);
        return;
      }
      if ("apply".equals(mode)) {
        if (args.length < 4) fail("apply requires expected.tsv");
        List<AclBinding> expected = parseTsv(Path.of(args[3]));
        applyCreate(admin, expected);
        return;
      }
      if ("delete".equals(mode)) {
        if (args.length < 4) fail("delete requires bindings.tsv");
        List<AclBinding> toDelete = parseTsv(Path.of(args[3]));
        applyDelete(admin, toDelete);
        return;
      }
      if ("reconcile".equals(mode)) {
        if (args.length < 4) fail("reconcile requires plan.tsv (action + fields)");
        List<AclBinding> toDelete = parsePlanTsv(Path.of(args[3]), "delete");
        List<AclBinding> toCreate = parsePlanTsv(Path.of(args[3]), "create");
        applyDelete(admin, toDelete);
        applyCreate(admin, toCreate);
        System.out.println("ACL_RECONCILE_OK delete=" + toDelete.size() + " create=" + toCreate.size());
        return;
      }
      fail("unknown mode " + mode);
    }
  }
}
