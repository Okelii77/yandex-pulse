// Offline candidate for public HTTP/gateway/TLS probes, not a deployable monitor.
package main
import("crypto/tls";"crypto/x509";"encoding/json";"fmt";"net";"net/http";"net/url";"os";"strings";"sync";"time";"io")
type Check struct{ID string `json:"id"`;Kind string `json:"kind"`;URL string `json:"url"`;Host string `json:"host"`;Port int `json:"port"`}
type Row struct{ID string `json:"id"`;Status string `json:"status"`;CheckedAt string `json:"checked_at"`;LatencyMS *int64 `json:"latency_ms"`;HTTPCode int `json:"http_code,omitempty"`}
func local(h string)bool{return h=="127.0.0.1"||h=="localhost"||h=="::1"}
func main(){if len(os.Args)!=2{panic("usage: core-go offline-fixture.json")};b,e:=os.ReadFile(os.Args[1]);if e!=nil{panic(e)};var spec struct{Checks []Check `json:"checks"`;CA string `json:"ca"`};if json.Unmarshal(b,&spec)!=nil{panic("fixture")};roots,_:=x509.SystemCertPool();if roots==nil{roots=x509.NewCertPool()};if spec.CA!=""&&!roots.AppendCertsFromPEM([]byte(spec.CA)){panic("CA")};tlsCfg:=&tls.Config{RootCAs:roots,MinVersion:tls.VersionTLS12};d:=&net.Dialer{Timeout:2*time.Second};client:=&http.Client{Timeout:2*time.Second,Transport:&http.Transport{TLSClientConfig:tlsCfg,DialContext:d.DialContext},CheckRedirect:func(r *http.Request,via []*http.Request)error{if !local(r.URL.Hostname())||len(via)>=10{return fmt.Errorf("unsafe redirect")};return nil}}
 rows:=make([]Row,len(spec.Checks));sem:=make(chan struct{},8);var wg sync.WaitGroup
 for i,c:=range spec.Checks{wg.Add(1);go func(i int,c Check){defer wg.Done();sem<-struct{}{};defer func(){<-sem}();r:=Row{ID:c.ID,Status:"unsupported"};t:=time.Now()
 switch c.Kind{case "http","http_gateway":u,e:=url.Parse(c.URL);r.Status="down";if e==nil&&u!=nil&&local(u.Hostname())&&u.User==nil&&(u.Scheme=="http"||u.Scheme=="https"){res,e:=client.Get(c.URL);if e==nil{r.HTTPCode=res.StatusCode;io.CopyN(io.Discard,res.Body,4096);res.Body.Close();switch{case r.HTTPCode>=200&&r.HTTPCode<400:r.Status="ok";case r.HTTPCode==401||r.HTTPCode==403||r.HTTPCode==404||r.HTTPCode==429:r.Status="degraded";case r.HTTPCode<500:r.Status="unknown"}}}
 case "tcp_tls":r.Status="down";if local(c.Host){cfg:=tlsCfg.Clone();cfg.ServerName=c.Host;conn,e:=tls.DialWithDialer(d,"tcp",net.JoinHostPort(c.Host,fmt.Sprint(c.Port)),cfg);if e==nil{conn.Close();r.Status="ok"}}
 case "music_ynison":r.Status="disabled"
 }
 if r.Status!="unsupported"&&r.Status!="disabled"{v:=time.Since(t).Milliseconds();r.LatencyMS=&v};r.CheckedAt=time.Now().UTC().Format(time.RFC3339);rows[i]=r}(i,c)}
 wg.Wait();_ = strings.Builder{};json.NewEncoder(os.Stdout).Encode(map[string]any{"schema":1,"results":rows})}
