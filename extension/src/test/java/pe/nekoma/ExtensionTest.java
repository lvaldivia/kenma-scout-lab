package pe.nekoma;

import burp.api.montoya.MontoyaApi;
import burp.api.montoya.core.ByteArray;
import burp.api.montoya.extension.Extension;
import burp.api.montoya.extension.ExtensionUnloadingHandler;
import burp.api.montoya.http.Http;
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.http.message.responses.HttpResponse;
import burp.api.montoya.logging.Logging;
import burp.api.montoya.repeater.Repeater;
import burp.api.montoya.scope.Scope;
import burp.api.montoya.ui.UserInterface;
import burp.api.montoya.ui.contextmenu.ContextMenuEvent;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiFunction;
import javax.swing.*;

/** Contract doubles test extension orchestration without a running Burp instance. */
public final class ExtensionTest {
    @SuppressWarnings("unchecked")
    static <T> T fake(Class<T> type, BiFunction<String,Object[],Object> call) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},
                (proxy,method,args)->call.apply(method.getName(),args));
    }
    static HttpRequest request(String path,String method,String body,boolean auth) {
        return fake(HttpRequest.class,(name,args)->switch(name){
            case "pathWithoutQuery","path" -> path;
            case "url" -> "http://127.0.0.1:3000"+path;
            case "method" -> method;
            case "bodyToString" -> body;
            case "hasHeader" -> auth;
            case "withPath" -> request((String)args[0],method,body,auth);
            case "withMethod" -> request(path,(String)args[0],body,auth);
            case "withBody" -> request(path,method,(String)args[0],auth);
            case "withHeader" -> request(path,method,body,auth);
            default -> null;
        });
    }
    static ContextMenuEvent event(HttpRequest request){
        var rr=fake(HttpRequestResponse.class,(n,a)->n.equals("request")?request:null);
        return fake(ContextMenuEvent.class,(n,a)->switch(n){
            case "messageEditorRequestResponse" -> Optional.empty();
            case "selectedRequestResponses" -> List.of(rr);
            default -> null;
        });
    }
    static void check(boolean result,String message){if(!result)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception{
        var inScope=new AtomicBoolean(true);
        var sent=new CopyOnWriteArrayList<HttpRequest>();
        var prepared=new CopyOnWriteArrayList<HttpRequest>();
        var done=new CountDownLatch(4);
        ExtensionUnloadingHandler[] unload={null};
        var api=fake(MontoyaApi.class,(n,a)->switch(n){
            case "extension" -> fake(Extension.class,(name,values)->{
                if(name.equals("registerUnloadingHandler"))unload[0]=(ExtensionUnloadingHandler)values[0];return null;
            });
            case "scope" -> fake(Scope.class,(name,values)->inScope.get());
            case "userInterface" -> fake(UserInterface.class,(name,values)->null);
            case "logging" -> fake(Logging.class,(name,values)->null);
            case "repeater" -> fake(Repeater.class,(name,values)->{prepared.add((HttpRequest)values[0]);return null;});
            case "http" -> fake(Http.class,(name,values)->{
                var r=(HttpRequest)values[0];sent.add(r);done.countDown();
                var bytes=fake(ByteArray.class,(key,v)->key.equals("length")?14:null);
                var response=fake(HttpResponse.class,(key,v)->switch(key){
                    case "statusCode" -> (short)200;
                    case "bodyToString" -> "{\"team\":\"KAR\"}";
                    case "body" -> bytes;
                    default -> null;
                });
                return fake(HttpRequestResponse.class,(key,v)->switch(key){
                    case "hasResponse" -> true;
                    case "response" -> response;
                    case "request" -> r;
                    default -> null;
                });
            });
            default -> null;
        });
        var extension=new KenmaScout();extension.initialize(api);
        try{
            SwingUtilities.invokeAndWait(()->{});
            var original=request("/api/reports/NEK-001","GET","",true);
            inScope.set(false);check(extension.provideMenuItems(event(original)).isEmpty(),"Out-of-scope must be ignored");
            inScope.set(true);
            check(extension.provideMenuItems(event(request("/api/reports/NEK-001","GET","",false))).isEmpty(),"Auth required");
            check(extension.provideMenuItems(event(request("/api/me","GET","",true))).isEmpty(),"Lab report path required");
            var menu=(JMenu)extension.provideMenuItems(event(original)).get(0);
            SwingUtilities.invokeAndWait(()->{menu.getItem(1).doClick();menu.getItem(2).doClick();});
            check(sent.isEmpty(),"PATCH/DELETE preparation must not send requests");
            check(prepared.get(0).method().equals("PATCH")&&prepared.get(0).path().equals("/api/me"),"PATCH target");
            check(prepared.get(0).bodyToString().equals("{\"role\":\"coach\"}"),"PATCH payload");
            check(prepared.get(1).method().equals("DELETE")&&prepared.get(1).path().equals("/api/reports/NEK-002"),"DELETE target");
            SwingUtilities.invokeAndWait(()->menu.getItem(0).doClick());
            check(done.await(5,TimeUnit.SECONDS),"Four GET requests must finish");
            check(sent.size()==4&&sent.stream().allMatch(r->r.method().equals("GET")),"Bounded GET-only comparison");
            check(sent.get(3).path().equals("/api/reports/KAR-003"),"Last target");
            System.out.println("Montoya: scope, auth, path, manual mutations and 4-GET comparison passed.");
        }finally{unload[0].extensionUnloaded();}
    }
}
