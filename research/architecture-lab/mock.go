package main
import("net/http";"time";"strconv")
func main(){http.HandleFunc("/",func(w http.ResponseWriter,r *http.Request){ms,_:=strconv.Atoi(r.URL.Query().Get("delay"));time.Sleep(time.Duration(ms)*time.Millisecond);w.Header().Set("Content-Type","application/json");w.Write([]byte(`{"ok":true}`))});http.ListenAndServe("127.0.0.1:18761",nil)}
