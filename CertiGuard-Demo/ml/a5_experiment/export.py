import torch, numpy as np, sys, onnxruntime as ort
sys.path.insert(0,'ml/a5_experiment'); from train import Net
net=Net(); net.load_state_dict(torch.load('ml/a5_experiment/tamper_cnn.pt')); net.eval()
class P(torch.nn.Module):
    def __init__(s,n): super().__init__(); s.n=n
    def forward(s,x): return torch.sigmoid(s.n(x))
m=P(net).eval(); x=torch.rand(7,1,64,64)
torch.onnx.export(m,x,'ml/a5_experiment/tamper_cnn.onnx',input_names=['x'],output_names=['p'],dynamic_axes={'x':{0:'n'},'p':{0:'n'}},opset_version=17,dynamo=False)
s=ort.InferenceSession('ml/a5_experiment/tamper_cnn.onnx'); a=s.run(None,{'x':x.numpy()})[0]; m.eval(); b=m(x).detach().numpy()
print('max diff',abs(a-b).max(), a.shape)
